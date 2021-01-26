import { executionAsyncId, AsyncResource } from 'async_hooks';
import { EventEmitter } from 'events';
import path from 'path';

import { collectSample } from '../v8-profiler';

import * as BI from '../bigint';
import { recordQueryWithExitPoint } from '../async_effect_helpers';
import { patchModules } from '../module_patches';
import { makeClassCallable, wrapType } from '../async';
import { QueryInformation } from '../types';

patchModules(['memcached'], (exports) => {
  const memcachedInternalCalls = new EventEmitter();

  const originalCommand = exports.prototype.command;

  exports.prototype.command = function command<T>(this: T, ...args: any): any {
    collectSample();
    const recordQuery = recordQueryWithExitPoint('memcached');
    const asyncId = executionAsyncId();
    const [makeQuery, server, ...rest] = args;

    const query = makeQuery();
    const queryCallback = query.callback;

    const outerThis = this;
    let actualServer = '';

    memcachedInternalCalls.once('connect', (server: string) => {
      actualServer = server;
    });

    query.callback = function handler<T, This>(
      this: This,
      error: Error | null,
      data: T | undefined,
    ) {
      const duration = BI.subtract(BI.now(), startTime);
      const result = queryCallback.call(this, error, data);

      recordQuery({
        startTime,
        duration,

        provider: 'memcached',
        host: actualServer || server || '',
        database: 'default',
        query: query.command,

        triggerAsyncId: asyncId,
      });

      return result;
    };

    const startTime = BI.now();
    return originalCommand.apply(this, [() => query, server, ...rest]);
  };

  const originalConnect = exports.prototype.connect;

  exports.prototype.connect = function connect<T>(this: T, ...args: any[]) {
    memcachedInternalCalls.emit('connect', ...args);

    return originalConnect.apply(this, args);
  };

  return exports;
});
