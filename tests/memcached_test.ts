import assert from 'assert';
import { triggerAsyncId, executionAsyncId } from 'async_hooks';
import os from 'os';
import { spawnSync } from 'child_process';

import { effects } from '../src/effects';

require('../src/module_patches/memcached').load();

import Memcached from 'memcached';

const HOST = process.env['MEMCACHED_HOST'] || 'localhost';
const PORT = '11211';
const DATABASE = 'default';

const memcached = new Memcached(`${HOST}:${PORT}`);

function disconnect() {
  memcached.end();
}

describe('memcached support', () => {
  after(disconnect);

  it('propagates async contexts into query callbacks', (done) => {
    const asyncId = executionAsyncId();

    memcached.get('foo', function (err, data) {
      if (err) {
        return done(err);
      }

      assert.equal(asyncId, triggerAsyncId());

      done();
    });
  }).timeout(10000);

  it('allows tracking memcached queries', (done) => {
    const asyncId = executionAsyncId();

    effects.once('query', (query) => {
      assert.equal(query.moduleName, 'memcached');
      assert.equal(typeof query.startTime, 'bigint');

      query.events.on('complete', (queryData) => {
        assert.equal(queryData.provider, 'memcached');
        assert.equal(queryData.query, 'get foo');
        assert.equal(queryData.host, `${HOST}:${PORT}`);
        assert.equal(queryData.database, DATABASE);
        done();
      });
    });

    memcached.get('foo', function (err, data) {
      if (err) {
        return done(err);
      }

      assert.equal(asyncId, triggerAsyncId());
    });
  }).timeout(10000);
});
