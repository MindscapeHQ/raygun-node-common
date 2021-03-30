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
const Events = Symbol('QueryEvents');
const Client = Symbol('Client');

type Client = {
  connectionParameters: {
    host: string;
    database: string;
  };
};

export function load() {
  const clientsQuerying: Client[] = [];

  patchModules([PATHS.pg.query], (exports) => {
    const WrappedQuery = wrapType(exports, ['handleDataRow', 'handleReadyForQuery'], ['text']);

    class Query<Args> extends WrappedQuery {
      [StartTime]: BI.PortableBigInt;
      [Events]: QueryEvents;
      [Client]: Client;

      constructor(...args: Args[]) {
        super(...args);
        this[StartTime] = now();
        this[Events] = recordQuery('pg', this[StartTime], executionAsyncId());
        this[Client] = clientsQuerying[clientsQuerying.length - 1];

        this.once('end', this.recordQuery);
      }

      handleError(error: Error, connection: any) {
        super.handleError(error, connection);

        this.off('end', this.recordQuery);
        this.recordQuery();
      }

      recordQuery() {
        console.log('recordQuery called!', this.text);
        const endTime = now();
        const duration = BI.subtract(endTime, this[StartTime]);

        const host = this[Client].connectionParameters.host;
        const database = this[Client].connectionParameters.database;

        const query = {
          provider: 'postgres',
          query: this.text,
          triggerAsyncId: this._asyncResource.triggerAsyncId(),
          duration,
          host,
          database,
          startTime: this[StartTime],
        };

        this[Events].emit('complete', query);
      }
    }

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
