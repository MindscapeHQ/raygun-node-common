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
  startTime: BI.PortableBigInt;
  triggerAsyncId: number;
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

function recordMongoQuery(event: MongoInstrumentationEvent, operation: MongoEventRecord) {
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
    triggerAsyncId: operation.triggerAsyncId,
  });

  operations.delete(event.requestId);
}

function paths(basePath: string): string[] {
  // this exists to support testing with multiple versions of mongodb
  // we have to install mongodb as aliased versions, and that breaks our patching by default
  return [basePath, basePath.replace('mongodb', 'mongodb4')];
}

const patchOptions = { versionConstraint: '>=4' };

export function load() {
  patchModules(
    paths(path.join('mongodb', 'lib', 'cmap', 'connection.js')),
    (exports: any) => {
      const OriginalConnection = exports.Connection;

      function Connection<This>(
        this: This,
        ...args: Parameters<typeof OriginalConnection>
      ): ReturnType<typeof OriginalConnection> {
        const connection = new OriginalConnection(...args);
        const operations = new Map<number, MongoEventRecord>();

        connection.on('commandStarted', (event: MongoInstrumentationEvent) => {
          if (event.commandName === 'ismaster') {
            return;
          }

          const startTime = BI.now();
          const query = { startTime };

          const queryEvents = recordQuery(`mongodb`, startTime, executionAsyncId());
          operations.set(event.requestId, {
            startTime,
            recordQuery: (q) => queryEvents.emit('complete', q),
            event,
            triggerAsyncId: executionAsyncId(),
          });
        });

        connection.on('commandFailed', (event: MongoInstrumentationEvent) => {
          const operation = operations.get(event.requestId);

          if (operation) {
            recordMongoQuery(event, operation);
          }
        });

        connection.on('commandSucceeded', (event: MongoInstrumentationEvent) => {
          const operation = operations.get(event.requestId);

          if (operation) {
            recordMongoQuery(event, operation);
          }
        });

        return connection;
      }

      return {
        ...exports,
        Connection,
      };

      return exports;
    },
    patchOptions,
  );

  patchModules(
    paths('mongodb'),
    (exports: any) => {
      const OriginalMongoClient = exports.MongoClient;

      function MongoClient<This>(
        this: This,
        ...args: Parameters<typeof OriginalMongoClient>
      ): ReturnType<typeof OriginalMongoClient> {
        const client = new OriginalMongoClient(...args);

        client.monitorCommands = true;

        return client;
      }

      MongoClient.prototype = OriginalMongoClient.prototype;

      return {
        ...exports,
        MongoClient,
      };
      return exports;
    },
    patchOptions,
  );
}
