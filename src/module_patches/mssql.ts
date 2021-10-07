import { executionAsyncId, AsyncResource } from 'async_hooks';
import path from 'path';

import * as BI from '../bigint';
import { recordQuery } from '../effects';
import { patchModules } from '../module_patches';
import {
  wrapFunctionReturningPromiseWithAsyncResource,
  wrapPromiseInAsyncResource,
  wrapType,
} from '../async';
import { QueryInformation } from '../types';

const { now } = BI;

const paths = [
  path.join('mssql', 'lib', 'tedious.js'),
  path.join('mssql', 'lib', 'tedious', 'index.js'),
  path.join('mssql', 'lib', 'msnodesqlv8.js'),
  path.join('mssql', 'lib', 'msnodesqlv8', 'index.js'),
];

export function load() {
  patchModules(paths, (exports) => {
    function wrapMethod<
      This extends {
        parent: {
          config: {
            server?: string;
            database?: string;
          };
        };
      },
      Args,
      CBReturn,
      Callback extends (this: This, ...args: Args[]) => CBReturn,
      MethodReturn,
      M extends (this: This, c: string, cb: Callback) => MethodReturn
    >(originalMethod: M) {
      return function wrapper(this: This, command: string, callback: Callback) {
        const asyncResource = new AsyncResource('MSSQL_COMMAND');
        const startTime = now();
        const queryEvents = recordQuery('mssql', startTime, executionAsyncId());
        const config = this.parent.config;
        const asyncId = executionAsyncId();

        function wrappedCallback(this: This, ...args: Args[]): CBReturn {
          const duration = BI.subtract(now(), startTime);

          queryEvents.emit('complete', {
            provider: 'sqlserver',
            host: config.server || 'localhost',
            database: config.database || '<default>',
            triggerAsyncId: asyncId,
            query: command,
            startTime,
            duration,
          });

          return asyncResource.runInAsyncScope(callback, this, ...args);
        }

        return originalMethod.call(this, command, wrappedCallback as Callback);
      };
    }

    exports.Request.prototype._query = wrapMethod(exports.Request.prototype._query);
    exports.Request.prototype._execute = wrapMethod(exports.Request.prototype._execute);
    const originalExecute = exports.Request.prototype.execute;

    exports.Request.prototype.bulk = wrapFunctionReturningPromiseWithAsyncResource(
      exports.Request.prototype.bulk,
      'MSSQL_BULK',
    );

    exports.Request.prototype.batch = wrapFunctionReturningPromiseWithAsyncResource(
      exports.Request.prototype.batch,
      'MSSQL_BATCH',
    );
    exports.Request.prototype.query = wrapFunctionReturningPromiseWithAsyncResource(
      exports.Request.prototype.query,
      'MSSQL_QUERY',
    );

    exports.Request.prototype.execute = wrapFunctionReturningPromiseWithAsyncResource(
      exports.Request.prototype.execute,
      'MSSQL_EXECUTE',
    );

    return exports;
  });
}
