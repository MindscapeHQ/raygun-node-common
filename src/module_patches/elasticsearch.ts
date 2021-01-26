import { executionAsyncId, AsyncResource } from 'async_hooks';
import path from 'path';

import * as BI from '../bigint';
import { recordQueryWithExitPoint } from '../async_effect_helpers';
import { patchModules } from '../module_patches';
import { makeClassCallable, wrapType } from '../async';
import { QueryInformation } from '../types';

const { now } = BI;

const StartTime = Symbol('StartTime');
const AsyncId = Symbol('AsyncId');
const RecordQuery = Symbol('RecordQuery');

patchModules(['@elastic/elasticsearch'], (exports: any) => {
  const Client = exports.Client;

  class WrappedClient extends Client {
    constructor(...args: Parameters<typeof Client>[]) {
      super(...args);

      this.on('request', function (err: any, req: any) {
        req[StartTime] = BI.now();
        req[AsyncId] = executionAsyncId();
        req[RecordQuery] = recordQueryWithExitPoint(`@elastic/elasticsearch`);
      });

      this.on('response', function (err: any, res: any) {
        const startTime = res[StartTime];
        const asyncId = res[AsyncId];
        const duration = BI.subtract(now(), startTime);

        const database = `${res.meta.request.params.method} ${res.meta.request.params.path}`;
        const query = res.meta.request.params.body || database;

        res[RecordQuery]({
          startTime,
          duration,
          provider: 'elasticsearch',
          query,
          host: res.meta.connection.id,
          database: `${res.meta.request.params.method} ${res.meta.request.params.path}`,
          triggerAsyncId: asyncId,
        });
      });
    }
  }

  exports.Client = WrappedClient;

  return exports;
});
