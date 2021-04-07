import type { EventEmitter } from 'events';
import { executionAsyncId, AsyncResource } from 'async_hooks';
import path from 'path';

import { wrapType } from '../async';
import * as BI from '../bigint';
import { QueryEvents, recordQuery } from '../effects';
import { patchModules } from '../module_patches';
import { QueryInformation } from '../types';

const { now } = BI;

const PATHS = {
  pg: {
    query: path.join('pg', 'lib', 'query.js'),
    client: path.join('pg', 'lib', 'client.js'),
  },
};

const StartTime = Symbol('StartTime');
const RecordQuery = Symbol('RecordQuery');
const Client = Symbol('Client');

type Client = {
  connectionParameters: {
    host: string;
    database: string;
  };
};

type Query = EventEmitter & {
  [StartTime]: BI.PortableBigInt;
  [RecordQuery]: () => void;
  [Client]: Client | null;
  _asyncResource: AsyncResource;

  text: string;
};

export function load() {
  const clientsQuerying: Client[] = [];

  patchModules([PATHS.pg.query], (exports) => {
    const WrappedQuery = wrapType(exports, ['handleDataRow', 'handleReadyForQuery'], ['text']);

    function Query<Args>(this: Query, ...args: Args[]) {
      WrappedQuery.apply(this, args);

      this[StartTime] = now();

      const queryEvents = recordQuery(`pg (${this.text})`, this[StartTime], executionAsyncId());

      this[RecordQuery] = function captureQuery(this: Query) {
        const endTime = now();
        const duration = BI.subtract(endTime, this[StartTime]);

        const host = this[Client]?.connectionParameters?.host || 'unknown';
        const database = this[Client]?.connectionParameters?.database || 'unknown';

        const query = {
          provider: 'postgres',
          query: this.text,
          triggerAsyncId: this._asyncResource.triggerAsyncId(),
          duration,
          host,
          database,
          startTime: this[StartTime],
        };

        queryEvents.emit('complete', query);
      }.bind(this);

      this[Client] = clientsQuerying[clientsQuerying.length - 1];

      if ((this as any)._once) {
        (this as any)._once('end', this[RecordQuery]);
      } else {
        this.once('end', this[RecordQuery]);
      }

      return this;
    }

    Query.prototype = WrappedQuery.prototype;

    const originalHandleError = Query.prototype.handleError;

    Query.prototype.handleError = function (this: any, ...args: any[]) {
      this[RecordQuery]();

      this.off('end', this[RecordQuery]);

      return originalHandleError.apply(this, args);
    };

    return Query;
  });

  patchModules([PATHS.pg.client], (exports) => {
    const query = exports.prototype.query;

    exports.prototype.query = function <Args>(this: Client, ...args: Args[]) {
      clientsQuerying.push(this);

      const returnValue = query.apply(this, args);

      clientsQuerying.pop();

      return returnValue;
    };

    return exports;
  });
}
