import { executionAsyncId, AsyncResource } from 'async_hooks';
import path from 'path';

import { recordQueryWithExitPoint } from '../async_effect_helpers';
import * as BI from '../bigint';
import { patchModules } from '../module_patches';
import { wrapType } from '../async';
import { QueryInformation } from '../types';

const { now } = BI;

patchModules([path.join('next', 'dist', 'server', 'next-dev-server.js')], (exports) => {
  const OriginalDevServer = exports.default;

  class DevServer extends OriginalDevServer {
    constructor(...args: Parameters<typeof OriginalDevServer>[]) {
      super(...args);

      // This is required to enable the propagation of async_hooks execution and trigger ids.
      //
      // This is because Next.js creates this devReady promise when creating the dev server,
      // and then awaits it before serving any request. When you await a promise in Node, a new
      // asynchronous context is created with the trigger id set to that of the promise.
      //
      // This breaks our ability to build traces from Next.js dev server request. The most
      // elegant solution I could think of was to replace that private field with a property
      // that returns a newly created Promise when accessed.
      //
      // This newly created Promise will have the trigger id set correctly, since it was created
      // during the request lifetime.
      //
      // This should work on Next.js v8+, as that's when this pattern was introduced.
      const devReady = this.devReady;

      Object.defineProperty(this, 'devReady', {
        get: () => new Promise((resolve) => devReady.then(resolve)),
      });
    }
  }

  exports.default = DevServer;

  return exports;
});
