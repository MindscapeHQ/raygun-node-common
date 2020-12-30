require('../src/module_patches').loadAll();

import { effects } from '../src/effects';

import assert from 'assert';
import { executionAsyncId, triggerAsyncId } from 'async_hooks';
import http from 'http';

const axios = require('axios');
import request from 'request';
import superagent from 'superagent';

type TestServer = {
  stop(): Promise<unknown>;
  port: number;
};

function sendHello(req: http.IncomingMessage, res: http.ServerResponse) {
  res.write('hello\n');
  res.end();
}

export function makeTestServer(
  port: number | undefined = undefined,
  handler = sendHello,
): Promise<TestServer> {
  // The Node TS bindings don't reflect that createServer can take a handler as the first option, and in fact must for Node 8.
  const server = (http.createServer as any)(handler);

  function stop() {
    return new Promise((resolve, reject) => {
      server.close(() => resolve(null));
    });
  }

  return new Promise((resolve, reject) => {
    let serverPort = 0;

    server.on('listening', () => {
      const address = server.address();

      if (address && typeof address === 'object') {
        serverPort = address.port;
      }

      resolve({ stop, port: serverPort });
    });

    server.listen(port);
  });
}

describe('http outgoing support', () => {
  it('propagates async contexts into request callbacks', async () => {
    const testServer = await makeTestServer();

    await new Promise<void>((resolve, reject) => {
      const asyncId = executionAsyncId();

      http.get(`http://localhost:${testServer.port}/`, (res) => {
        res.resume();
        res.on('error', reject);
        res.on('end', () => {
          assert.equal(asyncId, triggerAsyncId());
          resolve();
        });
      });
    });

    testServer.stop();
  });

  it('captures outgoing requests', async () => {
    const testServer = await makeTestServer();

    let done = () => {};

    const endPromise = new Promise<void>((resolve, reject) => {
      done = (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
    });

    effects.once('request', (req) => {
      req.events.on('error', done);
      req.events.on('complete', (request) => {
        assert.equal(request.direction, 'outgoing');
        assert.equal(request.url, `http://localhost:${testServer.port}/`);
        assert.equal(request.method, `GET`);
        assert.equal(request.status, 200);
        assert.equal(typeof request.startTime, 'bigint');
        assert.equal(typeof request.duration, 'bigint');
        assert.equal(typeof request.triggerAsyncId, 'number');
        done();
      });
    });

    await new Promise<void>((resolve, reject) => {
      const asyncId = executionAsyncId();

      http.get(`http://localhost:${testServer.port}/`, (res) => {
        res.resume();
        res.on('error', reject);
        res.on('end', () => {
          assert.equal(asyncId, triggerAsyncId());
          resolve();
        });
      });
    });

    testServer.stop();
    await endPromise;
  });
});
