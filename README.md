# raygun-node-common
Common code for the Raygun APM and Crash Reporting Node.js providers

Provides module patches for third party database adaptors and the http/s standard libraries to enable capturing requests/queries and propagating async contexts for storage/tracking.

## API

```js
const common = require('raygun-node-common');
```

### `common.effects : TypedEventEmitter`

Returns a `TypedEventEmitter` that will emit `query` and `request` events.

Each of these events passes another `TypedEventEmitter`, which can be used to listen for `complete` or `error` events on the effect.

A query `complete` event will pass a `QueryInformation` object.

```ts
type QueryInformation = {
  startTime: PortableBigInt;
  duration: PortableBigInt;

  provider: string;
  host: string;
  database: string;
  query: string;

  triggerAsyncId: number;
};
```

A request `complete` event will pass a `RequestInformation` object.

```ts
type RequestInformation = {
  direction: RequestDirection;
  url: string;
  method: string;
  status: number;
  startTime: PortableBigInt;
  duration: PortableBigInt;
  triggerAsyncId: number;
};
```

An `Error` object is passed with each `error` event.

### `common.modulePatches`

This package provides tools to patch standard library modules and third party packages. In addition, this module contains a set of patches for common third party database adaptors, and a patch to capture outgoing requests made via Node's http libraries.

#### `common.modulePatches.loadAll: () => void`;

Loads all the built-in module patches. Currently, this loads patches for:

* Node http/https libraries (outgoing request capturing)
* elasticsearch
* memcached
* mongodb
* mssql
* mysql
* mysql2
* pg
* redis
* ioredis

#### `common.modulePatches.patchModules: (modules: string[], patch: (exports: any) => any) => void`

Adds a new module patch. The `modules` argument is a list of module/filenames to be patched, and the `patch` argument is a function that's called on the exports of that module. The return value of this function replaces the exports for that module.


```js
common.patchModules('http', (exports) => {
  exports.get = () => console.log("patched out http.get");
});
```

These patches are applied when the module is first loaded, since Node caches the result of module loading and reuses it for future requires. `patchModules` will attempt to check if the module has already been loaded when the patch is created and error if so.

#### `common.modulePatches.patchAll: (patch: (exports: any) => any) => void`

Similar to `patchModules`, but the patch will be applied to all modules loaded after that point.

#### `common.modulePatches.safeResolve: (packagePath: string) => string | null`

A simple helper function that wraps around `require.resolve`, but will return `null` instead of throwing an exception if the path cannot be resolved.

### `common.BI`

Provides an implementation of `BigInt` that defaults to using native BigInts, but falls back to [JSBI](https://github.com/GoogleChromeLabs/jsbi) if BigInt is not available. See the JSBI documentation for more info, as this conforms to the JSBI interface.
