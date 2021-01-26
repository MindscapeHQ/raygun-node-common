import { executionAsyncId, AsyncResource } from "async_hooks";
import path from "path";

import { wrapType } from "../async";
import * as BI from "../bigint";
import { recordQuery } from "../effects";
import { patchModules } from "../module_patches";

const { now } = BI;

const PATHS = {
  pg: {
    query: path.join("pg", "lib", "query.js"),
    client: path.join("pg", "lib", "client.js"),
  },
};

export function load() {
  patchModules([PATHS.pg.query], (exports) => {
    const wrappedType = wrapType(
      exports,
      ["handleDataRow", "handleReadyForQuery"],
      ["text"]
    );

    return wrappedType;
  });

  patchModules([PATHS.pg.client], (exports) => {
    const query = exports.prototype.query;

    exports.prototype.query = function <
      This extends {
        connectionParameters: {
          host: string;
          database: string;
        };
        text: string;
        _asyncResource: AsyncResource;
      },
      Config,
      Values,
      Results,
      Callback extends (e: Error | null, result: Results) => void
    >(
      this: This,
      config: Config,
      values: Values | Callback,
      callback?: Callback
    ) {
      const host = this.connectionParameters.host;
      const database = this.connectionParameters.database;

      if (typeof values === "function") {
        callback = values as any;
      }

      const newCallback = function wrappedQuery(
        this: This,
        error: Error | null,
        result: Results
      ) {
        const endTime = now();
        if (callback) {
          callback.call(this, error, result);
        }

        const duration = BI.subtract(endTime, startTime);

        queryEvents.emit("complete", {
          startTime,
          provider: "postgres",
          query: this.text,
          triggerAsyncId: this._asyncResource.triggerAsyncId(),
          duration,
          host,
          database,
        });
      };

      const startTime = BI.now();
      const queryEvents = recordQuery("pg", startTime, executionAsyncId());
      const returnValue = query.call(this, config, values, newCallback);
      return returnValue;
    };

    return exports;
  });
}
