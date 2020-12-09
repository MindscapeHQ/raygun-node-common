import { executionAsyncId } from 'async_hooks';
import { ClientRequest, ServerResponse } from 'http';

import { makeActiveProfileExitPoint } from '../async';
import { recordHTTPRequestWithExitPoint } from '../async_effect_helpers';
import * as BI from '../bigint';
import { patchModules } from '../module_patches';
import { ExitPoint, RequestInformation } from '../types';

const now = BI.now;

type ResponseCallback = (res: ServerResponse) => void;

patchModules(['http', 'https'], (exports, moduleName) => {
  const request = exports.request;

  function captureOutgoingRequest(
    req: ClientRequest & { method: string },
    res: ServerResponse,
    startTime: BI.PortableBigInt,
    recordHTTPRequest: (r: Omit<RequestInformation, 'threadId'>) => void,
    asyncId: number,
  ) {
    const endTime = now();
    const host = req.getHeaders().host;
    let url = '';

    url += `${moduleName}://`;
    url += host || 'UNKNOWN';

    url += req.path;

    recordHTTPRequest({
      direction: 'outgoing',
      url,
      method: req.method || 'UNKNOWN',
      status: res.statusCode,
      startTime,
      duration: BI.subtract(endTime, startTime),
      triggerAsyncId: asyncId,
    });
  }

  function wrappedRequest(options: object, cb: ResponseCallback) {
    const startTime = now();
    const recordHTTPRequest = recordHTTPRequestWithExitPoint(`${moduleName}.request(...)`);
    const asyncId = executionAsyncId();

    const req = request(options, cb);

    req.once('response', function () {
      captureOutgoingRequest(req, req.res, startTime, recordHTTPRequest, asyncId);
    });

    req.once('error', recordHTTPRequest.abort);

    return req;
  }

  exports.request = wrappedRequest;

  const get = exports.get;

  function wrappedGet(options: object, cb: ResponseCallback) {
    const startTime = now();
    const recordHTTPRequest = recordHTTPRequestWithExitPoint(`${moduleName}.get(...)`);
    const asyncId = executionAsyncId();
    const req = get(options, cb);

    req.once('response', function () {
      captureOutgoingRequest(req, req.res, startTime, recordHTTPRequest, asyncId);
    });

    req.once('error', recordHTTPRequest.abort);

    return req;
  }

  exports.get = wrappedGet;

  return exports;
});
