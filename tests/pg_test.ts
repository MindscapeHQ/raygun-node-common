import assert from 'assert';
import { triggerAsyncId, executionAsyncId } from 'async_hooks';
import os from 'os';
import { spawnSync } from 'child_process';

import { effects } from '../src/effects';

require('../src/module_patches').loadAll();

import { Client } from 'pg';

const USER = process.env['PGUSER'] || os.userInfo().username;
const HOST = process.env['PGHOST'] || 'localhost';
const PORT = parseInt(process.env['PGPORT'] || '', 10) || 5432;
const PASSWORD = process.env['PGPASSWORD'] || '';
const DATABASE = process.env['PGDATABASE'] || 'apm_nodejs_test';

const client = new Client({
  user: USER,
  password: PASSWORD,
  port: PORT,
  host: HOST,
  database: DATABASE,
});

describe('pg support', () => {
  before(() => client.connect());
  after(() => client.end());

  it('propagates async contexts into query callbacks', (done) => {
    const asyncId = executionAsyncId();

    client.query('SELECT 1', [], (err, res) => {
      if (err) {
        return done(err);
      }

      assert.equal(asyncId, triggerAsyncId());

      done();
    });
  });

  it('allows tracking postgres queries', (done) => {
    const asyncId = executionAsyncId();

    effects.once('query', (query) => {
      assert.equal(query.moduleName, 'pg');
      assert.equal(typeof query.startTime, 'bigint');

      query.events.on('complete', (queryData) => {
        assert.equal(queryData.provider, 'postgres');
        assert.equal(queryData.query, 'SELECT 1');
        assert.equal(queryData.host, HOST);
        assert.equal(queryData.database, DATABASE);
        done();
      });
    });

    client.query('SELECT 1', [], (err, res) => {
      if (err) {
        throw err;
      }
    });
  });
});
