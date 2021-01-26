import { makeActiveProfileExitPoint } from '../async';
import { DEBUG_ENABLED } from '../debug';
import { methodSource } from '../process_profile/method_source';
import { MethodSource, ExitPoint } from '../types';

type Timeout = ReturnType<typeof originalSetTimeout>;
type Immediate = ReturnType<typeof originalSetImmediate>;
type SourceFile = { fileName: string; functionName: string };

const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
const originalSetImmediate = global.setImmediate;
const originalClearImmediate = global.clearImmediate;

const setTimeoutExitPoints: Map<Timeout, ExitPoint> = new Map();
const setImmediateExitPoints: Map<Immediate, ExitPoint> = new Map();

function returnCallerSite(err: Error, callsites: NodeJS.CallSite[]): SourceFile | null {
  for (const callsite of callsites) {
    const fileName = callsite.getFileName();

    // skip all callsites in current file
    if (fileName === __filename) {
      continue;
    }

    return {
      fileName: fileName || '',
      functionName: callsite.getFunctionName() || '',
    };
  }

  return null;
}

function getCallsite(): SourceFile | null {
  const originalPrepareStacktrace = Error.prepareStackTrace;

  Error.prepareStackTrace = returnCallerSite;

  const output: any = {};

  Error.captureStackTrace(output);

  const callsite = output.stack;
  Error.prepareStackTrace = originalPrepareStacktrace;
  return callsite;
}

function _setTimeout<T>(
  this: T,
  ...args: Parameters<typeof originalSetTimeout>
): ReturnType<typeof originalSetTimeout> {
  const caller = getCallsite();

  if (caller) {
    const callerType = methodSource(caller.fileName, caller.functionName);

    if (callerType === MethodSource.KnownLibrary) {
      return originalSetTimeout.apply(this, args);
    }
  }

  const [cb, timeout, ...rest] = args;

  let callsite = '';

  if (DEBUG_ENABLED && Error.captureStackTrace) {
    const capture: any = {};

    Error.captureStackTrace(capture);

    callsite = '\n' + capture.stack.split('\n').slice(1).join('\n');
  }

  const exitPoint = makeActiveProfileExitPoint('setTimeout' + callsite);

  function callback(...innerArgs: typeof rest) {
    (cb as Function)(...innerArgs);
    exitPoint();
  }

  const id = originalSetTimeout.apply(this, [callback, timeout, ...rest]);

  setTimeoutExitPoints.set(id, exitPoint);

  return id;
}

function _clearTimeout<T>(
  this: T,
  ...args: Parameters<typeof originalClearTimeout>
): ReturnType<typeof originalClearTimeout> {
  const id = args[0];
  if (id) {
    const exitPoint = setTimeoutExitPoints.get(id);

    if (exitPoint) {
      exitPoint();
    }
  }

  return originalClearTimeout.apply(this, args);
}

function _setImmediate<T>(
  this: T,
  ...args: Parameters<typeof originalSetImmediate>
): ReturnType<typeof originalSetImmediate> {
  const [cb, ...rest] = args;
  const exitPoint = makeActiveProfileExitPoint('setImmediate');

  function callback(...innerArgs: typeof rest) {
    (cb as Function)(...innerArgs);
    exitPoint();
  }

  const id = originalSetImmediate.apply(this, [callback, ...rest]);

  setImmediateExitPoints.set(id, exitPoint);

  return id;
}

function _clearImmediate<T>(
  this: T,
  ...args: Parameters<typeof originalClearImmediate>
): ReturnType<typeof originalClearImmediate> {
  const id = args[0];

  if (id) {
    const exitPoint = setImmediateExitPoints.get(id);

    if (exitPoint) {
      exitPoint();
    }
  }

  return originalClearImmediate.apply(this, args);
}

global.setTimeout = _setTimeout as typeof originalSetTimeout;
global.clearTimeout = _clearTimeout as typeof originalClearTimeout;
global.setImmediate = _setImmediate as typeof originalSetImmediate;
