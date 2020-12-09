process.env.V8_PROFILER_EAGER_LOGGING = 'true';
process.env.RAYGUN_APM_INSIDE_WORKER_THREAD = 'true';
const profiler = require('v8-profiler-node8');

process.on('uncaughtException', function (err) {
  console.log(err);
});

import { executionAsyncId } from 'async_hooks';

import * as BI from '../../bigint';
import { scopedDebug } from '../../debug';
import { recordEffectsToProfile } from '../../effects';
import { makeExitPointManager } from '../../exit_points';
import type { InProgressProfile, CapturedProfile } from '../../types';

import { serialize } from './serialization';

import type { MessagePort } from 'worker_threads';
import '../../load_all_module_patches';

const workerThreads = require('worker_threads');
const WORKER_TIMEOUT_IN_MS = 60 * 1000;

const debug = scopedDebug('worker-runtime');

let workerData = workerThreads.workerData;
let port: MessagePort;

const profiles = new Map<string, InProgressProfile>();

function startProfiling(id: string) {
  profiler.startProfiling(id);

  const startTime = BI.now();
  const asyncId = executionAsyncId();

  const exitPoints = makeExitPointManager(() => {});

  const timeoutExitPoint = exitPoints.makeExitPoint(
    `worker profiler timeout (${WORKER_TIMEOUT_IN_MS}ms)`,
    {
      forceExit: true,
    },
  );
  const timeoutExitPointId = setTimeout(timeoutExitPoint, WORKER_TIMEOUT_IN_MS);

  const profile: InProgressProfile = {
    asyncId,
    startTime,
    rootFrameLabel: 'Worker.worker_threads',
    relatedAsyncIds: new Set([asyncId]),
    activeAsyncIds: new Set(),
    exitPoints,
    effects: {
      queries: [],
      requests: [],
      exceptions: [],
      workerProfiles: [],
    },
    end: [() => Promise.resolve(clearTimeout(timeoutExitPointId))],
  };

  recordEffectsToProfile(profile, true);
  profiles.set(id, profile);
}

Object.defineProperty(workerThreads, 'workerData', {
  get: () => workerData,
  set: (v) => {
    if (!port) {
      port = v.RAYGUN_APM_WORKER_BRIDGE;
      const profileOnStart = v.RAYGUN_APM_PROFILE_ON_START;

      if (profileOnStart) {
        startProfiling(profileOnStart.toString());
      }

      setupApmBridge(port);

      return (workerData = v.USER_WORKER_DATA);
    } else {
      return (workerData = v);
    }
  },
});

const profileId = 0;

function setupApmBridge(port: MessagePort) {
  port.on('message', (m) => {
    debug('message', m);
    if (m.type === 'START_PROFILING') {
      startProfiling(m.name);
      port.postMessage({ type: 'PROFILING_STARTED', name: m.name });
    }

    if (m.type === 'STOP_PROFILING') {
      const completeProfiles: CapturedProfile[] = [];

      for (const id of m.profilesToStop) {
        const profile = profiler.stopProfiling(id.toString());

        const inProgressProfile = profiles.get(id.toString());

        if (inProgressProfile) {
          inProgressProfile.exitPoints.forceComplete();

          const capturedProfile: CapturedProfile = {
            rootFrameLabel: inProgressProfile.rootFrameLabel,
            startTime: inProgressProfile.startTime,
            asyncId: inProgressProfile.asyncId,
            effects: inProgressProfile.effects,
            relatedAsyncIds: inProgressProfile.relatedAsyncIds,
            v8Profile: profile,
          };

          completeProfiles.push(capturedProfile);
        }
      }

      port.postMessage({
        type: 'PROFILING_COMPLETE',
        payload: JSON.stringify(completeProfiles, serialize),
      });
    }
  });
}

export {};
