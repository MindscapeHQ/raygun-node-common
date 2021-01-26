import { AsyncResource, executionAsyncId } from 'async_hooks';
import path from 'path';
import type { Worker, WorkerOptions, MessageChannel, MessagePort } from 'worker_threads';

import { collectSample, V8Profile } from '../../v8-profiler';

import { activeProfile } from '../../async';
import { scopedDebug } from '../../debug';
import { recordWorkerThreadProfile } from '../../effects';
import { safeResolve } from '../../module_patches';
import { CapturedProfile } from '../../types';

import { deserialize } from './serialization';

interface Constructor<T> {
  new (...args: any[]): T;
}

const debug = scopedDebug('worker');

const APM_MESSAGE_PORT = Symbol('APM_MESSAGE_PORT');
const WORKER_PROFILES = Symbol('WORKER_PROFILES');
const WORKER_RUNTIME_PATH = require.resolve('./worker_runtime');
let typescriptWorkersEnabled = false;

export function enableTypeScriptWorkers(): void {
  typescriptWorkersEnabled = true;
}

export function makeProfiledWorkerClass(
  Worker: Constructor<Worker>,
  MessageChannel: Constructor<MessageChannel>,
) {
  if (!WORKER_RUNTIME_PATH) {
    debug(`Could not find worker runtime path, aborting worker_threads patch.`);
    return Worker;
  }

  return class ProfiledWorker extends Worker {
    [APM_MESSAGE_PORT]: MessagePort;
    [WORKER_PROFILES]: Set<number>;

    constructor(urlOrCode: string, options: WorkerOptions = {}) {
      const apmChannel = new MessageChannel();

      const userWorkerData = options.workerData;

      const currentProfile = activeProfile();
      const profileOnStart = currentProfile && currentProfile.asyncId;

      options.workerData = {
        RAYGUN_APM_WORKER_BRIDGE: apmChannel.port1,
        RAYGUN_APM_PROFILE_ON_START: profileOnStart,
        USER_WORKER_DATA: options.workerData,
      };

      const userTransferList = options.transferList || [];

      options.transferList = [apmChannel.port1, ...userTransferList];

      const execArgv = options.execArgv || process.execArgv;

      execArgv.unshift(`--require=${WORKER_RUNTIME_PATH}`);

      if (typescriptWorkersEnabled || WORKER_RUNTIME_PATH.endsWith('.ts')) {
        execArgv.unshift(`--require=ts-node/register`);
      }

      options.execArgv = execArgv;

      super(urlOrCode, options);

      this[WORKER_PROFILES] = new Set();
      if (currentProfile) {
        this[WORKER_PROFILES].add(currentProfile.asyncId);
        currentProfile.end.unshift(this.stopProfiling.bind(this, [currentProfile.asyncId]));
      }
      this[APM_MESSAGE_PORT] = apmChannel.port2;
      debug(`created profiled worker`);
    }

    postMessage(value: any, transferList?: Array<ArrayBuffer | MessagePort>) {
      collectSample();
      this.startProfiling().then(() => {
        super.postMessage(value, transferList);
      });
    }

    startProfiling(): Promise<boolean> {
      const currentProfile = activeProfile();

      if (!currentProfile) {
        return Promise.resolve(false);
      }

      if (this[WORKER_PROFILES].has(currentProfile.asyncId)) {
        return Promise.resolve(false);
      }

      debug(`startProfiling ${currentProfile.asyncId}`);

      this[WORKER_PROFILES].add(currentProfile.asyncId);

      currentProfile.end.unshift(this.stopProfiling.bind(this, [currentProfile.asyncId]));

      const workerProfileName = currentProfile.asyncId.toString();
      const apmPort = this[APM_MESSAGE_PORT];

      return new Promise((resolve, reject) => {
        function handler(message: any) {
          debug('message from worker', message);
          if (message.type === 'PROFILING_STARTED') {
            resolve(true);
            apmPort.off('message', handler);
          }
        }

        apmPort.on('message', handler);
        apmPort.postMessage({ type: 'START_PROFILING', name: workerProfileName });
      });
    }

    stopProfiling(profilesToStop: number[]): Promise<void> {
      const apmPort = this[APM_MESSAGE_PORT];
      const threadId = this.threadId;
      const activeProfiles = profilesToStop.filter((id) => this[WORKER_PROFILES].has(id));

      if (activeProfiles.length === 0) {
        return Promise.resolve();
      }

      debug(`stopProfiling: ${profilesToStop.join(',')}`);

      return new Promise((resolve, reject) => {
        function handler(m: any) {
          if (m.type !== 'PROFILING_COMPLETE') {
            return;
          }

          const rawMessage = JSON.parse(m.payload, deserialize);

          if (rawMessage === null) {
            return;
          }

          const threadProfiles = rawMessage as CapturedProfile[];

          for (const threadProfile of threadProfiles) {
            // The APM agent considers threads to be 1 indexed, and Node is zero indexed.
            // Therefore we need to reserve 1 for the main thread, hence the off by one
            const offsetThreadId = threadId + 1;

            recordWorkerThreadProfile({
              profile: threadProfile,
              threadId: offsetThreadId,
              triggerAsyncId: parseInt(threadProfile.v8Profile.title, 10),
            });
          }

          resolve();
          apmPort.off('message', handler);
        }

        for (const id of activeProfiles) {
          this[WORKER_PROFILES].delete(id);
        }

        apmPort.on('message', handler);

        apmPort.postMessage({ type: 'STOP_PROFILING', profilesToStop: activeProfiles });
      });
    }

    terminate() {
      return this.stopProfiling(Array.from(this[WORKER_PROFILES])).then(() => super.terminate());
    }

    on<T>(eventName: string | symbol, listener: (f: T) => void) {
      const asyncResource = new AsyncResource(`ProfiledWorker.on("${String(eventName)}")`);
      return super.on(eventName, (...args: T[]) => {
        return asyncResource.runInAsyncScope(listener, this, ...args);
      });
    }
  };
}
