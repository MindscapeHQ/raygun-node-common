import { AsyncResource, executionAsyncId } from 'async_hooks';
import path from 'path';

import { wrapType } from '../async';
import { recordQuery } from '../effects';
import * as BI from '../bigint';
import { scopedDebug } from '../debug';
import { patchModules } from '../module_patches';
import { QueryInformation } from '../types';

const debug = scopedDebug('mongodb patch');

type MongoEventRecord = {
  event: MongoInstrumentationEvent;
  asyncResource: AsyncResource;
  startTime: BI.PortableBigInt;
  recordQuery: (q: Omit<QueryInformation, 'threadId'>) => void;
};

const operations = new Map<number, MongoEventRecord>();

type MongoInstrumentationEvent = {
  connectionId?: string | MongoConnection;
  commandName: string;
  requestId: number;
  address: string;
  databaseName: string;
  command: Object;
};

type MongoConnection = {
  host: string;
  port: number;
};

type HasAsyncResource = { _asyncResource: AsyncResource };

function recordMongoQuery(event: MongoInstrumentationEvent) {
  const operation = operations.get(event.requestId);

  if (!operation) {
    return;
  }

  const duration = BI.subtract(BI.now(), operation.startTime);

  if (event.commandName === 'ismaster') {
    return;
  }

  let host = operation.event.address || '';

  if (!host && event.connectionId) {
    if (typeof event.connectionId === 'string') {
      host = event.connectionId;
    } else {
      host = `${event.connectionId.host}:${event.connectionId.port}`;
    }
  }

  operation.recordQuery({
    startTime: operation.startTime,
    duration,

    provider: 'mongodb',
    host,
    database: operation.event.databaseName,
    query: JSON.stringify(operation.event.command),
    triggerAsyncId: operation.asyncResource.triggerAsyncId(),
  });

  operations.delete(event.requestId);
}

function paths(basePath: string): string[] {
  // this exists to support testing with multiple versions of mongodb
  // we have to install mongodb as aliased versions, and that breaks our patching by default
  return [basePath, basePath.replace('mongodb', 'mongodb3')];
}

const patchOptions = { versionConstraint: '<=3' };

export function load() {
  patchModules(
    paths('mongodb'),
    (exports: any) => {
      const listener = exports.instrument(() => {});

      listener.on('started', function (event: MongoInstrumentationEvent) {
        const startTime = BI.now();
        if (event.commandName === 'ismaster') {
          return;
        }
        const queryEvents = recordQuery(`mongodb`, startTime, executionAsyncId());
        operations.set(event.requestId, {
          event,
          startTime,
          asyncResource: new AsyncResource(`MONGO_OPERATION`),
          recordQuery: (q) => queryEvents.emit('complete', q),
        });
      });

      listener.on('succeeded', recordMongoQuery);
      listener.on('failed', recordMongoQuery);

      return exports;
    },
    patchOptions,
  );

  patchModules(
    paths(path.join('mongodb', 'lib', 'operations', 'operation.js')),
    (exports: any) => {
      exports.OperationBase = wrapType(exports.OperationBase, [], []);

      return exports;
    },
    patchOptions,
  );

  patchModules(
    paths(path.join('mongodb', 'lib', 'operations', 'execute_operation.js')),
    (exports: any) => {
      const executeOperation = exports;

      function wrappedExecuteOperation<
        This,
        Topology,
        Operation extends HasAsyncResource,
        Callback
      >(this: This, topology: Topology, operation: Operation, callback: Callback) {
        return operation._asyncResource.runInAsyncScope(
          executeOperation,
          this,
          topology,
          operation,
          callback,
        );
      }

      return wrappedExecuteOperation;
    },
    patchOptions,
  );

  patchModules(
    paths(path.join('mongodb', 'lib', 'core', 'connection', 'msg.js')),
    (exports: any) => {
      const parse = exports.BinMsg.prototype.parse;

      exports.BinMsg.prototype.parse = function wrappedParse<
        This,
        WorkItem extends { requestId: number }
      >(this: This, workItem: WorkItem) {
        const asyncResource = operations.get(workItem.requestId)?.asyncResource;

        if (asyncResource) {
          return asyncResource.runInAsyncScope(parse, this, workItem);
        } else {
          return parse.call(this, workItem);
        }
      };

      return exports;
    },
    patchOptions,
  );
}
