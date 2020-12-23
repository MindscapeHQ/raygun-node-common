import assert from 'assert';
import { triggerAsyncId, executionAsyncId } from 'async_hooks';
import os from 'os';
import { spawnSync } from 'child_process';

import { effects } from '../src/effects';

require('../src/module_patches').loadAll();

import Redis from 'ioredis';

type Client = Redis.Redis;

const HOST = process.env['REDIS_HOST'] || '127.0.0.1';
const PORT = 6379;
const DATABASE = '0';

let client: Client | null = null;

function connectAndSeedDatabase(done: (err?: Error) => void) {
  client = new Redis(PORT, HOST);

  done();
}

function disconnect() {
  if (client) {
    client.disconnect();
  }
}

describe('ioredis support', () => {
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

      debugger;

      assert.equal(asyncId, triggerAsyncId());

      done();
    });
  }).timeout(10000);

  it('allows tracking ioredis queries', (done) => {
    const asyncId = executionAsyncId();

    effects.once('query', (query) => {
      assert.equal(query.moduleName, 'ioredis');
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
