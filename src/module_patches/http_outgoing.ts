import { executionAsyncId, AsyncResource } from 'async_hooks';
import { ClientRequest, ServerResponse } from 'http';

import { wrapFunctionWithAsyncResource, wrapEventEmitterWithAsyncResource } from '../async';
import { RUNNING_ON_AZURE } from '../azure';
import { recordRequest } from '../effects';
import * as BI from '../bigint';
import { patchModules } from '../module_patches';
import { RequestInformation } from '../types';

const now = BI.now;

type ResponseCallback = (res: ServerResponse) => void;

export function load() {
  patchModules(
    ['http', 'https'],
    (exports, moduleName) => {
      const request = exports.request;

      function captureOutgoingRequest(
        req: ClientRequest & { method: string },
        res: ServerResponse,
        startTime: BI.PortableBigInt,
        recordHTTPRequest: (r: Omit<RequestInformation, 'threadId'>) => void,
        asyncId: number,
      ) {
        wrapEventEmitterWithAsyncResource(res, new AsyncResource('REQUEST', asyncId));
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
        const requestEvents = recordRequest(
          `${moduleName}.request(...)`,
          startTime,
          executionAsyncId(),
        );
        const recordHTTPRequest = (r: RequestInformation) => requestEvents.emit('complete', r);
        const asyncId = executionAsyncId();

        const asyncResource = new AsyncResource('REQUEST');

        const req = request(options, wrapFunctionWithAsyncResource(cb, null, asyncResource));

        req.prependOnceListener('response', function () {
          captureOutgoingRequest(req, req.res, startTime, recordHTTPRequest, asyncId);
        });

        req.prependOnceListener('error', (e: Error) => requestEvents.emit('error', e));

        return req;
      }

      exports.request = wrappedRequest;

      const get = exports.get;

      function wrappedGet(options: object, cb: ResponseCallback) {
        const startTime = now();
        const requestEvents = recordRequest(
          `${moduleName}.get(...)`,
          startTime,
          executionAsyncId(),
        );
        const recordHTTPRequest = (r: RequestInformation) => requestEvents.emit('complete', r);
        const asyncId = executionAsyncId();
        const req = get(
          options,
          wrapFunctionWithAsyncResource(cb, null, new AsyncResource('REQUEST')),
        );

        req.prependOnceListener('response', function () {
          captureOutgoingRequest(req, req.res, startTime, recordHTTPRequest, asyncId);
        });

        req.prependOnceListener('error', (e: Error) => requestEvents.emit('error', e));

        return req;
      }

      exports.get = wrappedGet;

      return exports;
    },
    !RUNNING_ON_AZURE,
  );
}
