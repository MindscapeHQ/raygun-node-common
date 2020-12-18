import assert from 'assert';
import { triggerAsyncId, executionAsyncId } from 'async_hooks';

import { effects } from '../src/effects';

require('../src/module_patches/mssql').load();

const mssql = require('mssql');

const USER = process.env.MSSQL_USER || 'sa';
const PASSWORD = process.env.MSSQL_PASSWORD || 'reallyStrongPwd123';
const HOST = process.env.MSSQL_HOST || 'localhost';
const DATABASE = process.env.MSSQL_DATABASE || 'master';

async function connectAndSeedDatabase() {
  await connect();

  await mssql.query([
    `
    IF OBJECT_ID(N'dbo.TEST', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TEST (Name varchar(64) not null);
    END;`,
  ]);

  const results = await mssql.query([`SELECT COUNT(*) as count FROM [dbo].[TEST]`]);
  const count = results.recordset[0].count;

  if (count === 0) {
    await mssql.query([
      `
      INSERT INTO [dbo].[TEST]
      (
        [Name]
      )
      VALUES
      ${new Array(1000).fill("(\n'Test'\n)").join(',')}
    `,
    ]);
  }
}

function connect() {
  return mssql.connect({
    user: USER,
    password: PASSWORD,
    server: HOST,
    port: 1433,
    database: DATABASE,
    encrypt: false,
    options: {
      enableArithAbort: true,
    },
  });
}

function disconnect() {
  mssql.close();
}

describe('mssql support', () => {
  before(connectAndSeedDatabase);
  after(disconnect);

  context('when using promises', () => {
    it('propagates async contexts into query callbacks', (done) => {
      const asyncId = executionAsyncId();

      mssql
        .query([`SELECT * FROM [dbo].[TEST]`])
        .then(() => {
          assert.equal(asyncId, triggerAsyncId());

          done();
        })
        .catch(done);
    }).timeout(10000);
  });

  context('when using callbacks', () => {
    it('propagates async contexts into query callbacks', (done) => {
      const asyncId = executionAsyncId();

      new mssql.Request().query([`SELECT * FROM [dbo].[TEST]`], (err: Error, results: any) => {
        if (err) {
          throw err;
        }
        assert.equal(asyncId, triggerAsyncId());

        done();
      });
    }).timeout(10000);
  });

  it('allows tracking mssql queries', (done) => {
    const asyncId = executionAsyncId();

    effects.once('query', (query) => {
      assert.equal(query.moduleName, 'mssql');
      assert.equal(typeof query.startTime, 'bigint');

      query.events.on('complete', (queryData) => {
        assert.equal(queryData.provider, 'sqlserver');
        assert.equal(queryData.query, 'SELECT * FROM [dbo].[TEST]');
        assert.equal(queryData.host, HOST);
        assert.equal(queryData.database, DATABASE);
        done();
      });
    });

    mssql.query([`SELECT * FROM [dbo].[TEST]`]);
  });
});
