import assert from 'assert';
import dns from 'dns';
import os from 'os';
import { spawnSync } from 'child_process';

require('../src/module_patches').loadAll();

import { effects } from '../src/effects';
import * as BI from '../src/bigint';
import { MongoClient } from 'mongodb4';

const USER = process.env['MONGOUSER'] || os.userInfo().username;
const HOST = process.env['MONGOHOST'] || '127.0.0.1';
const PORT = parseInt(process.env['MONGOPORT'] || '', 10) || 27017;
const PASSWORD = process.env['MONGOPASSWORD'] || '';
const DATABASE = process.env['MONGODATABASE'] || 'test';

const url = `mongodb://${HOST}:${PORT}`;
const client = new MongoClient(url);

type Client = MongoClient;

function connectAndSeedDatabase(done: (err?: Error) => void) {
  client
    .connect()
    .then(() => done())
    .catch(done);
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

describe('mongodb4 support', () => {
  before(connectAndSeedDatabase);
  after(disconnect);

  it('captures mongodb queries during profiles', async () => {
    let serverIp: string | null = null;

    try {
      serverIp = await lookupHostname();
    } catch (e) {
      // ignore it
    }

    effects.once('query', (query) => {
      assert.equal(query.moduleName, 'mongodb');
      assert.equal(typeof query.startTime, 'bigint');

      query.events.once('complete', (queryMessage) => {
        assert.equal(queryMessage.provider, 'mongodb');

        if (serverIp) {
          assert.equal(queryMessage.host, `${serverIp}:${PORT}`);
        } else {
          assert.equal(queryMessage.host, `${HOST}:${PORT}`);
        }

        assert.equal(queryMessage.database, 'test');

        const query = JSON.parse(queryMessage.query);

        assert.equal(query.find, 'test');
        assert.equal(typeof queryMessage.duration, 'bigint');
        assert(queryMessage.duration > BI.BigInt(0));
      });
    });

    const db = client.db('test');

    db.collection('test').findOne(function (err, data) {
      if (err) {
        throw err;
      }
    });
  }).timeout(10000);

  it("doesn't throw an error with query methods that don't return a cursor", (done) => {
    const db = client.db('test');

    db.collection('test')
      .find({})
      .toArray(function (err: any, data: any) {
        if (err) {
          return done(err);
        }

        done();
      } as any);
  }).timeout(10000);

  it('records a query frame for update calls', (done) => {
    effects.once('query', (query) => {
      assert.equal(query.moduleName, 'mongodb');
      assert.equal(typeof query.startTime, 'bigint');

      query.events.on('complete', (queryMessage) => {
        done();
      });
    });

    const db = client.db('test');

    db.collection('test').updateMany({ $where: 'true' }, { $set: { c: 'd' } }, {}, function (
      err: any,
      data: any,
    ) {
      if (err) {
        return done(err);
      }
    } as any);
  }).timeout(5000);

  describe('extended query support', () => {
    it('records a query frame for count calls', (done) => {
      effects.once('query', (query) => {
        assert.equal(query.moduleName, 'mongodb');
        assert.equal(typeof query.startTime, 'bigint');

        query.events.on('complete', (queryMessage) => {
          done();
        });
      });

      const db = client.db('test');

      db.collection('test')
        .find()
        .count(function (err: any, data: any) {
          if (err) {
            return done(err);
          }
        } as any);
    }).timeout(5000);
  });
});
