import assert from 'assert';
import { triggerAsyncId, executionAsyncId } from 'async_hooks';
import os from 'os';

import { effects } from '../src/effects';

require('../src/module_patches/mysql2').load();

import mysql, { Connection } from 'mysql2';

let connection: Connection;

const HOST = process.env.MYSQL_HOST || 'localhost';
const USER = process.env.MYSQL_USER || os.userInfo().username;
const PASSWORD = process.env.MYSQL_PASSWORD || 'password';
const DATABASE = process.env.MYSQL_DATABASE || 'apm_nodejs_test';

function connectAndSeedDatabase(done: (err?: Error) => void) {
  connection = mysql.createConnection({
    host: HOST,
    user: USER,
    password: PASSWORD,
  });

  connection.query(`CREATE DATABASE IF NOT EXISTS ${DATABASE}`, [], (err) => {
    if (err) {
      return done(err);
    }
    connection.changeUser({ database: DATABASE }, (err) => {
      if (err) {
        return done(err);
      }
      done();
    });
  });
}

function disconnect() {
  connection.end();
}

describe('mysql support', () => {
  before(connectAndSeedDatabase);
  after(disconnect);

  it('propagates async contexts into query callbacks', (done) => {
    const asyncId = executionAsyncId();
    connection.query('SELECT 1', [], (err) => {
      if (err) {
        throw err;
      }
      done();
    });
  }).timeout(10000);

  it('allows tracking postgres queries', (done) => {
    const asyncId = executionAsyncId();

    effects.once('query', (query) => {
      assert.equal(query.moduleName, 'mysql');
      assert.equal(typeof query.startTime, 'bigint');

      query.events.on('complete', (queryData) => {
        assert.equal(queryData.provider, 'mysql');
        assert.equal(queryData.query, 'SELECT 1');
        assert.equal(queryData.host, HOST);
        assert.equal(queryData.database, DATABASE);
        done();
      });
    });

    connection.query('SELECT 1', [], (err) => {
      if (err) {
        throw err;
      }
    });
  });
});
