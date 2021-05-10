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

      const devReady = this.devReady;

      Object.defineProperty(this, 'devReady', {
        get: () => new Promise((resolve) => devReady.then(resolve)),
      });
    }
  }

  exports.default = DevServer;

  return exports;
});
