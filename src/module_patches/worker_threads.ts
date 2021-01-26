import { scopedDebug } from '../debug';
import { checkFeatureExplicitlyEnabled, checkFeatureExplicitlyDisabled } from '../features';
import { patchModules } from '../module_patches';
import { makeProfiledWorkerClass } from './worker_threads/profiled_worker';

const debug = scopedDebug('worker-threads-patch');

const [major, minor, patch] = process.versions.node.split('.').map((part) => parseInt(part, 10));

type Output = {
  threadId: number;
};

const output: Output = {
  threadId: 0,
};

export const workerThreadsSupported =
  (major === 12 && minor >= 17) || (major === 13 && minor >= 13) || major >= 14;

if (workerThreadsSupported) {
  if (
    !process.env.RAYGUN_APM_INSIDE_WORKER_THREAD &&
    !checkFeatureExplicitlyDisabled('RAYGUN_APM_WORKER_PROFILING')
  ) {
    patchModules(['worker_threads'], (exports) => {
      exports.Worker = makeProfiledWorkerClass(exports.Worker, exports.MessageChannel);

      return exports;
    });
  }

  output.threadId = require('worker_threads').threadId;
} else if (checkFeatureExplicitlyEnabled('RAYGUN_APM_WORKER_PROFILING')) {
  console.error(
    `[raygun-apm] Warning: Support for worker_threads profiling disabled. Node >=v12.17.x, >=v13.13.x or v14.x onwards required. Currently using: Node v${process.versions.node}`,
  );
}

export const { threadId } = output;
