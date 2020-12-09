import { executionAsyncId, AsyncResource } from 'async_hooks';
import path from 'path';

import * as BI from '../bigint';
import { recordQueryWithExitPoint } from '../async_effect_helpers';
import { patchModules } from '../module_patches';
import { wrapType } from '../async';
import { QueryInformation } from '../types';

const { now } = BI;

const paths = [
  path.join('mssql', 'lib', 'tedious.js'),
  path.join('mssql', 'lib', 'tedious', 'index.js'),
  path.join('mssql', 'lib', 'msnodesqlv8.js'),
  path.join('mssql', 'lib', 'msnodesqlv8', 'index.js'),
];

patchModules(paths, (exports) => {
  function wrapMethod<
    This extends {
      parent: {
        config: {
          server: string;
          database: string;
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
      const startTime = now();
      const recordQuery = recordQueryWithExitPoint(`mssql ${command}`);
      const config = this.parent.config;
      const asyncId = executionAsyncId();

      function wrappedCallback(this: This, ...args: Args[]): CBReturn {
        const duration = BI.subtract(now(), startTime);

        recordQuery({
          provider: 'sqlserver',
          host: config.server,
          database: config.database,
          triggerAsyncId: asyncId,
          query: command,
          startTime,
          duration,
        });

        return callback.apply(this, args);
      }

      return originalMethod.call(this, command, wrappedCallback as Callback);
    };
  }

  exports.Request.prototype._query = wrapMethod(exports.Request.prototype._query);
  exports.Request.prototype._execute = wrapMethod(exports.Request.prototype._execute);

  return exports;
});
