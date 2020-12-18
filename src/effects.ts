import { EventEmitter } from "events";
import type { QueryInformation, RequestInformation } from "./types";
import * as BI from "./bigint";

const kEvents = Symbol("kEvents");

export class TypedEventEmitter<T> {
  private events: EventEmitter;

  constructor() {
    this.events = new EventEmitter();
  }

  on<K extends keyof T, V extends T[K]>(s: K, f: (v: V) => void) {
    this.events.on(s as string | symbol, f);
  }

  once<K extends keyof T, V extends T[K]>(s: K, f: (v: V) => void) {
    this.events.once(s as string | symbol, f);
  }

  off<K extends keyof T, V extends T[K]>(s: K, f: (v: V) => void) {
    this.events.off(s as string | symbol, f);
  }

  emit<K extends keyof T, V extends T[K]>(s: K, v: V) {
    this.events.emit(s as string | symbol, v);
  }
}

export type Query = {
  events: TypedEventEmitter<{
    error: Error;
    complete: QueryInformation;
  }>;
  asyncId: number;
  startTime: BI.PortableBigInt;
  moduleName: string;
};

export type Request = {
  events: TypedEventEmitter<{
    error: Error;
    complete: RequestInformation;
  }>;
  asyncId: number;
  startTime: BI.PortableBigInt;
  moduleName: string;
};

export const effects = new TypedEventEmitter<{
  query: Query;
  request: Request;
}>();

export function recordQuery(
  moduleName: string,
  startTime: BI.PortableBigInt,
  asyncId: number
): Query["events"] {
  const events = new TypedEventEmitter();
  effects.emit("query", {
    startTime,
    moduleName,
    events,
    asyncId,
  });

  return events;
}

export function recordRequest(
  moduleName: string,
  startTime: BI.PortableBigInt,
  asyncId: number
): Request["events"] {
  const events = new TypedEventEmitter();
  effects.emit("request", {
    startTime,
    moduleName,
    events,
    asyncId,
  });

  return events;
}
