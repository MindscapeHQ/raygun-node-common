import assert from "assert";
import { triggerAsyncId, executionAsyncId } from "async_hooks";
import os from "os";
import { spawnSync } from "child_process";

import { effects } from "../src/effects";

require("../src/module_patches/elasticsearch").load();

import elastic from "@elastic/elasticsearch";

type Client = elastic.Client;

const HOST = process.env["ELASTIC_HOST"] || "localhost";
const PORT = "9200";
const DATABASE = "customer";

let client: Client | null = null;

async function connectAndSeedDatabase() {
  client = new elastic.Client({ node: `http://${HOST}:${PORT}` });

  await client.index({
    index: DATABASE,
    body: {
      name: "Test",
    },
  });
}

function disconnect() {
  if (client) {
    client.close();
  }
}

describe("elastic support", () => {
  before(connectAndSeedDatabase);
  after(disconnect);

  it("propagates async contexts into query callbacks", (done) => {
    const asyncId = executionAsyncId();

    if (!client) {
      throw new Error(`Client is not connected!`);
    }

    client
      .search({
        index: DATABASE,
        size: 500,
        body: {
          query: {
            match_all: {},
          },
        },
      })
      .then(() => {
        assert.equal(asyncId, triggerAsyncId());

        done();
      })
      .catch(done);
  });

  it("allows tracking elastic queries", (done) => {
    const asyncId = executionAsyncId();

    effects.once("query", (query) => {
      assert.equal(query.moduleName, "@elastic/elasticsearch");
      assert.equal(typeof query.startTime, "bigint");

      query.events.once("complete", (queryData) => {
        assert.equal(queryData.provider, "elasticsearch");
        assert.equal(queryData.query, '{"query":{"match_all":{}}}');
        assert.equal(queryData.host, `http://${HOST}:${PORT}/`);
        assert.equal(queryData.database, `POST /${DATABASE}/_search`);
        done();
      });
    });

    if (!client) {
      throw new Error(`Client is not connected!`);
    }

    client
      .search({
        index: DATABASE,
        size: 500,
        body: {
          query: {
            match_all: {},
          },
        },
      })
      .catch(done);
  });
});
