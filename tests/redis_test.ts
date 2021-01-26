import assert from 'assert';
import { triggerAsyncId, executionAsyncId } from 'async_hooks';
import os from 'os';
import { spawnSync } from 'child_process';

import { effects } from '../src/effects';

require('../src/module_patches').loadAll();

import redis from 'redis';

type Client = redis.RedisClient;

const HOST = process.env['REDIS_HOST'] || '127.0.0.1';
const PORT = 6379;
const DATABASE = '0';

let client: Client | null = null;

function connectAndSeedDatabase(done: (err?: Error) => void) {
  client = redis.createClient(PORT, HOST);

  done();
}

function disconnect() {
  if (client) {
    client.end(true);
  }
}

describe('redis support', () => {
  before(connectAndSeedDatabase);
  after(disconnect);

  it('propagates async contexts into query callbacks', (done) => {
    if (!client) {
      throw new Error(`Client is not connected!`);
    }

    const asyncId = executionAsyncId();

    client.hgetall('test', function (err: any, data: any) {
      if (err) {
        throw err;
      }

      assert.equal(asyncId, triggerAsyncId());

      done();
    });
  }).timeout(10000);

  it('allows tracking redis queries', (done) => {
    const asyncId = executionAsyncId();

    effects.once('query', (query) => {
      assert.equal(query.moduleName, 'redis');
      assert.equal(typeof query.startTime, 'bigint');

      query.events.on('complete', (queryData) => {
        assert.equal(queryData.provider, 'redis');
        assert.equal(queryData.query, 'hgetall "test"');
        assert.equal(queryData.host, `${HOST}:${PORT}`);
        assert.equal(queryData.database, DATABASE);
        done();
      });
    });

    if (!client) {
      throw new Error(`Client is not connected!`);
    }

    client.hgetall('test', function (err: any, data: any) {
      if (err) {
        throw err;
      }
    });
  });
});
