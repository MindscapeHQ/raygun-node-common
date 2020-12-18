import { executionAsyncId, AsyncResource } from "async_hooks";
import path from "path";

import * as BI from "../bigint";
import { recordQueryWithExitPoint } from "../async_effect_helpers";
import { recordQuery } from "../effects";
import { patchModules } from "../module_patches";
import { makeClassCallable, wrapType } from "../async";
import { QueryInformation } from "../types";

const { now } = BI;

const StartTime = Symbol("StartTime");
const AsyncId = Symbol("AsyncId");
const RecordQuery = Symbol("RecordQuery");

function wrapFunctionWithAsyncResource<This, Args, RT>(
  f: (this: This, ...args: Args[]) => RT,
  t: This,
  asyncResource: AsyncResource
) {
  return (...args: Args[]): RT => asyncResource.runInAsyncScope(f, t, ...args);
}

function wrapPromiseInAsyncResource<T>(
  p: Promise<T>,
  asyncResource: AsyncResource
): Promise<T> {
  const oldThen = p.then;
  const oldCatch = p.catch;

  p.then = function then<This, R>(
    this: This,
    ...args: [
      onfulfilled?: ((value: T) => unknown) | null | undefined,
      onrejected?: ((reason: any) => unknown) | null | undefined
    ]
  ): any {
    const newPromise = (oldThen as any).apply(
      p,
      args.map((f) =>
        typeof f === "function"
          ? wrapFunctionWithAsyncResource(f, this, asyncResource)
          : f
      )
    );

    return wrapPromiseInAsyncResource(newPromise, asyncResource);
  };

  p.catch = function _catch<This, RT>(this: This, f: (err: Error) => RT): any {
    const newPromise = (oldCatch as any).apply(
      p,
      wrapFunctionWithAsyncResource(f, this, asyncResource)
    );

    return wrapPromiseInAsyncResource(newPromise, asyncResource);
  };

  return p;
}

export function load() {
  patchModules(["@elastic/elasticsearch/lib/Transport.js"], (exports: any) => {
    const Transport = exports;

    const oldRequest = Transport.prototype.request;

    Transport.prototype.request = function request<This>(
      this: This,
      ...args: Parameters<typeof Transport.prototype.request>
    ): ReturnType<typeof Transport.prototype.request> {
      const asyncResource = new AsyncResource(
        "ELASTIC_REQUEST",
        executionAsyncId()
      );

      return wrapPromiseInAsyncResource(
        oldRequest.apply(this, args),
        asyncResource
      );
    };

    return exports;
  });

  patchModules(["@elastic/elasticsearch"], (exports: any) => {
    const Client = exports.Client;

    class WrappedClient extends Client {
      constructor(...args: Parameters<typeof Client>[]) {
        super(...args);

        this.on("request", function (err: any, req: any) {
          req[StartTime] = BI.now();
          req[AsyncId] = executionAsyncId();
          const queryEvents = recordQuery(
            "@elastic/elasticsearch",
            req[StartTime],
            req[AsyncId]
          );
          req[RecordQuery] = (q: QueryInformation) =>
            queryEvents.emit("complete", q);
        });

        this.on("response", function (err: any, res: any) {
          const startTime = res[StartTime];
          const asyncId = res[AsyncId];
          const duration = BI.subtract(now(), startTime);

          const database = `${res.meta.request.params.method} ${res.meta.request.params.path}`;
          const query = res.meta.request.params.body || database;

          res[RecordQuery]({
            startTime,
            duration,
            provider: "elasticsearch",
            query,
            host: res.meta.connection.id,
            database: `${res.meta.request.params.method} ${res.meta.request.params.path}`,
            triggerAsyncId: asyncId,
          });
        });
      }
    }

    exports.Client = WrappedClient;

    return exports;
  });
}
