import assert from 'assert';
import { triggerAsyncId, executionAsyncId } from 'async_hooks';
import dns from 'dns';
import os from 'os';
import { spawnSync } from 'child_process';

require('../src/module_patches').loadAll();

import { effects } from '../src/effects';
import { MongoClient } from 'mongodb';

const USER = process.env['MONGOUSER'] || os.userInfo().username;
const HOST = process.env['MONGOHOST'] || '127.0.0.1';
const PORT = parseInt(process.env['MONGOPORT'] || '', 10) || 27017;
const PASSWORD = process.env['MONGOPASSWORD'] || '';
const DATABASE = process.env['MONGODATABASE'] || 'test';

let client: Client | null = null;

type Client = MongoClient;

const url = `mongodb://${HOST}:${PORT}`;

const MONGO_VERSION_PARTS = require('mongodb/package.json')
  .version.split('.')
  .map((p: string) => parseInt(p, 10));
const MONGO_MAJOR_VERSON = MONGO_VERSION_PARTS[0];
const MONGO_MINOR_VERSION = MONGO_VERSION_PARTS[1];

function connectAndSeedDatabase(done: (err?: Error) => void) {
  const options =
    MONGO_MAJOR_VERSON >= 3 ? { useNewUrlParser: true, useUnifiedTopology: true } : {};
  MongoClient.connect(url, options, (err: Error | null, mongoClient: Client) => {
    if (err) {
      return done(err);
    }

    client = mongoClient;
    done();
  });
}

function disconnect() {
  if (client) {
    client.close();
  }
}

async function lookupHostname(): Promise<string> {
  return new Promise((resolve, reject) => {
    dns.lookup(HOST, (err, result) => {
      if (err) {
        return reject(err);
      }

      return resolve(result);
    });
  });
}

describe('mongodb support', () => {
  before(connectAndSeedDatabase);
  after(disconnect);

  it('propagates async contexts into query callbacks', (done) => {
    if (!client) {
      throw new Error(`Client is not connected!`);
    }

    const db = client.db('test');

    db.collection('test')
      .find()
      .toArray(function (err, data) {
        if (err) {
          throw err;
        }

        done();
      });
  }).timeout(10000);

  it('allows tracking mongo queries', (done) => {
    const asyncId = executionAsyncId();

    effects.once('query', (query) => {
      assert.equal(query.moduleName, 'mongodb');
      assert.equal(typeof query.startTime, 'bigint');

      query.events.on('complete', (queryData) => {
        assert.equal(queryData.provider, 'mongodb');

        const query = JSON.parse(queryData.query);
        assert.equal(query.find, 'test');

        assert.equal(queryData.host, `${HOST}:${PORT}`);
        assert.equal(queryData.database, DATABASE);
        done();
      });
    });

    if (!client) {
      throw new Error(`Client is not connected!`);
    }

    const db = client.db('test');

    db.collection('test').find().toArray();
  });
});
