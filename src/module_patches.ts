import path from 'path';

import semver from 'semver';
import Hook from 'require-in-the-middle';

// Unfortunately object is about the best type we can do for exports, to get the
// real type we would need a way to look up the type definition of a module at compile time
export type Exports = { [key: string]: any };
export type PatchFunction = (exports: Exports, name: string) => Exports;
export type Patch = {
  apply: PatchFunction;
  versionConstraint: string | null;
};
export type PatchOptions = { errorIfAlreadyLoaded?: boolean; versionConstraint?: string | null };

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

export function patchModules(
  modules: string[],
  apply: PatchFunction,
  patchOptions: PatchOptions = { errorIfAlreadyLoaded: true, versionConstraint: null },
) {
  const { errorIfAlreadyLoaded, versionConstraint } = patchOptions;

  for (const moduleName of modules) {
    if (errorIfAlreadyLoaded) {
      errorIfModuleIsAlreadyLoaded(moduleName);
    }

    const modulePatches = patches.get(moduleName) || [];

    const patch = {
      apply,
      versionConstraint: versionConstraint || null,
    };

    modulePatches.push(patch);

    patches.set(moduleName, modulePatches);
  }
}

export function patchAll(patch: Patch) {
  globalPatches.push(patch);
}

const versions = new Map<string, string | null>();

function getModuleVersion(baseDir: string): string | null {
  const versionInCache = versions.get(baseDir);

  if (versionInCache) {
    return versionInCache;
  }

  const version = require(path.join(baseDir, 'package.json'))?.version || null;

  versions.set(baseDir, version);

  return version;
}

Hook(null, { internals: true }, function (exports: Exports, name: string, baseDir: string) {
  for (const globalPatch of globalPatches) {
    exports = globalPatch.apply(exports, name);
  }

  const modulePatches = patches.get(name);

  if (modulePatches) {
    for (const patch of modulePatches) {
      let patchApplies = true;

      if (patch.versionConstraint) {
        const version = getModuleVersion(baseDir);

        patchApplies = Boolean(version && semver.satisfies(version, patch.versionConstraint));
      }

      if (patchApplies) {
        exports = patch.apply(exports, name);
      }
    }
  }

  return exports;
});

let loaded = false;

export function loadAll() {
  if (loaded) {
    return;
  }

  loaded = true;

  const patches = [
    'http_outgoing',
    'elasticsearch',
    'graphql',
    'memcached',
    'mongodb3',
    'mongodb4',
    'mssql',
    'mysql',
    'mysql2',
    'next',
    'pg',
    'redis',
  ];

  for (const patch of patches) {
    require(path.resolve(__dirname, 'module_patches', patch)).load();
  }
}
