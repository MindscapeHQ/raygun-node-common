import { executionAsyncId, AsyncResource } from 'async_hooks';
import path from 'path';

import { collectSample } from '../v8-profiler';

import { wrapType } from '../async';
import { recordQueryWithExitPoint } from '../async_effect_helpers';
import * as BI from '../bigint';
import { patchModules } from '../module_patches';

const { now } = BI;

const PATHS = {
  pg: {
    query: path.join('pg', 'lib', 'query.js'),
    client: path.join('pg', 'lib', 'client.js'),
  },
};

patchModules([PATHS.pg.query], (exports) => {
  const wrappedType = wrapType(exports, ['handleDataRow', 'handleReadyForQuery'], ['text']);

  return wrappedType;
});

patchModules([PATHS.pg.client], (exports) => {
  const query = exports.prototype.query;

  exports.prototype.query = function <
    This extends {
      connectionParameters: {
        host: string;
        database: string;
      };
      text: string;
      _asyncResource: AsyncResource;
    },
    Config,
    Values,
    Results,
    Callback extends (e: Error | null, result: Results) => void
  >(this: This, config: Config, values: Values | Callback, callback?: Callback) {
    collectSample();
    const host = this.connectionParameters.host;
    const database = this.connectionParameters.database;

    if (typeof values === 'function') {
      callback = values as any;
    }

    const newCallback = function wrappedQuery(this: This, error: Error | null, result: Results) {
      const endTime = now();
      if (callback) {
        callback.call(this, error, result);
      }

      const duration = BI.subtract(endTime, startTime);

      recordQuery({
        provider: 'postgres',
        query: this.text,
        triggerAsyncId: this._asyncResource.triggerAsyncId(),
        duration,
        host,
        database,
        startTime,
      });
    };

    collectSample();
    const startTime = now();
    const recordQuery = recordQueryWithExitPoint(`pg`);
    const returnValue = query.call(this, config, values, newCallback);
    return returnValue;
  };

  return exports;
});
