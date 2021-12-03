import { EventEmitter } from 'events';
import type { QueryInformation, RequestInformation } from './types';
import * as BI from './bigint';

const kEvents = Symbol('kEvents');

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

export type QueryEvents = TypedEventEmitter<{
  error: Error;
  complete: QueryInformation;
}>;

export type Query = {
  events: QueryEvents;
  asyncId: number;
  startTime: BI.PortableBigInt;
  moduleName: string;
};

export type RequestEvents = TypedEventEmitter<{
  error: Error;
  complete: RequestInformation;
}>;

export type Request = {
  events: RequestEvents;
  asyncId: number;
  startTime: BI.PortableBigInt;
  moduleName: string;
};

export type GraphQL = { asyncId: number; query: string };

export const effects = new TypedEventEmitter<{
  query: Query;
  request: Request;
  graphql: GraphQL;
}>();

export function recordQuery(
  moduleName: string,
  startTime: BI.PortableBigInt,
  asyncId: number,
): QueryEvents {
  const events: QueryEvents = new TypedEventEmitter();

  effects.emit('query', {
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
  asyncId: number,
): Request['events'] {
  const events = new TypedEventEmitter();
  effects.emit('request', {
    startTime,
    moduleName,
    events,
    asyncId,
  });

  return events;
}
