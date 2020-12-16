import makeDebug from "debug";

const debug = makeDebug("raygun-node-common");

export function scopedDebug(s: string): (...args: any[]) => void {
  return debug.bind(null, `[${s}]`);
}

export const DEBUG_ENABLED = makeDebug.enabled("raygun-node-common");

export default debug;
