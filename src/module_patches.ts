import path from 'path';
import Hook from 'require-in-the-middle';

// Unfortunately object is about the best type we can do for exports, to get the
// real type we would need a way to look up the type definition of a module at compile time
export type Exports = { [key: string]: any };
export type Patch = (exports: Exports, name: string) => Exports;

const globalPatches: Patch[] = [];
const patches: Map<string, Patch[]> = new Map();
const defaultModules = new Set(require('module').builtinModules);

export function safeResolve(packagePath: string): string | null {
  try {
    return require.resolve(packagePath);
  } catch (e) {
    return null;
  }
}

function alreadyLoadedError(moduleName: string) {
  const moduleRequiredBeforeApm = `${moduleName} was required before raygun-apm.\n\nIn order to provide support for ${moduleName}, raygun-apm must be required first.\n\nFix:\n - Move raygun-apm require/import to top of entry point\n`;

  return new Error(moduleRequiredBeforeApm);
}

function errorIfModuleIsAlreadyLoaded(moduleName: string) {
  if (defaultModules.has(moduleName)) {
    // moduleLoadList is an undocumented field on process, but it's existed since at least node 0.12 and still exists in the same format in node 14
    // this code is designed to fail silently if moduleLoadList doesn't exist, since there's no official way I know of to check if a builtin module has been loaded
    const p = process as { moduleLoadList?: string[] };

    if (p.moduleLoadList && p.moduleLoadList.includes(`NativeModule ${moduleName}`)) {
      throw alreadyLoadedError(moduleName);
    }
    return;
  }

  const pathParts = moduleName.split(path.sep);
  const packageName = pathParts[0];
  const modulePath = pathParts.slice(1);

  const packagePath = safeResolve(path.join(packageName, 'package.json'));

  if (!packagePath) {
    return;
  }

  const packageDir = path.dirname(packagePath);

  const absolutePath = path.join(packageDir, ...modulePath);

  if (absolutePath in require.cache) {
    throw alreadyLoadedError(packageName);
  }
}

export function patchModules(modules: string[], patch: Patch, errorIfAlreadyLoaded = true) {
  for (const moduleName of modules) {
    if (errorIfAlreadyLoaded) {
      errorIfModuleIsAlreadyLoaded(moduleName);
    }

    const modulePatches = patches.get(moduleName) || [];

    modulePatches.push(patch);

    patches.set(moduleName, modulePatches);
  }
}

export function patchAll(patch: Patch) {
  globalPatches.push(patch);
}

Hook(null, { internals: true }, function (exports: Exports, name: string) {
  for (const globalPatch of globalPatches) {
    exports = globalPatch(exports, name);
  }

  const modulePatches = patches.get(name);

  if (modulePatches) {
    for (const patch of modulePatches) {
      exports = patch(exports, name);
    }
  }

  return exports;
});

let loaded = false;

export function loadAll() {
  if (loaded) {
    return;
  }
  console.log('loading!');

  loaded = true;

  const patches = [
    'elasticsearch',
    'memcached',
    'mongodb',
    'mssql',
    'mysql',
    'mysql2',
    'pg',
    'redis',
  ];

  for (const patch of patches) {
    require(path.resolve('./src/module_patches/', patch)).load();
  }
}
