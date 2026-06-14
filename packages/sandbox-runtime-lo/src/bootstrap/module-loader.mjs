import {
  dirname,
  fileUrlToPath,
  isBareSpecifier,
  joinPaths,
  normalizePath,
  parsePackageSpecifier,
  resolvePath,
} from './path-utils.mjs'

const textDecoder = new TextDecoder()
const importFromPattern = /(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g
const importBarePattern = /(import\s+['"])(\.{1,2}\/[^'"]+)(['"])/g
const importCallPattern = /(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g
const requireCallPattern = /(require\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g

const zlibStubSource = `
const unsupported = () => {
  throw new Error("node:zlib is not available in the lo sandbox runtime");
};

export const constants = Object.freeze({});
export const createGzip = unsupported;
export const createGunzip = unsupported;
export const gzipSync = unsupported;
export const gunzipSync = unsupported;
export default {
  constants,
  createGzip,
  createGunzip,
  gzipSync,
  gunzipSync,
};
`.trim()

const turndownStubSource = `
export default class TurndownService {
  constructor() {}

  turndown() {
    throw new Error("turndown is not available in the lo sandbox runtime");
  }
}
`.trim()

const commonJsNamedExportWrappers = {
  'brace-expansion': ['EXPANSION_MAX', 'expand'],
  'sprintf-js': ['sprintf', 'vsprintf'],
}
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const debugEnabled = () => globalThis.process?.env?.SANDBOX_LO_DEBUG_MODULES === '1'
const debugLog = (message) => {
  if (!debugEnabled()) {
    return
  }

  if (globalThis.process?.versions?.node) {
    process.stderr.write(`[sandbox-lo-loader] ${message}\n`)
    return
  }

  globalThis.lo?.core?.write_string?.(
    globalThis.lo.core.STDERR,
    `[sandbox-lo-loader] ${message}\n`,
  )
}

const isNodeRuntime = () => Boolean(globalThis.process?.versions?.node)

const readTextFileInLo = (path) => {
  const runtime = globalThis.lo
  const core = runtime?.core

  if (!runtime?.ptr || !core?.open || !core?.fstat || !core?.read2 || !core?.close) {
    throw new Error('lo runtime does not expose the module loader read primitives')
  }

  const statBytes = runtime.ptr(new Uint8Array(160))
  const statWords = new BigUint64Array(statBytes.buffer)
  const fd = core.open(path, core.defaultReadFlags, 0)

  if (fd < 0) {
    throw new Error(`could not open ${path}: errno ${runtime.errno}`)
  }

  try {
    if (core.fstat(fd, statBytes.ptr) !== 0) {
      throw new Error(`could not stat ${path}: errno ${runtime.errno}`)
    }

    const size = core.os === 'mac' ? Number(statWords[12]) : Number(statWords[6])

    if (size <= 0) {
      return ''
    }

    const bytes = runtime.ptr(new Uint8Array(size))
    const readCount = core.read2(fd, bytes.ptr, bytes.length)

    if (readCount < 0) {
      throw new Error(`could not read ${path}: errno ${runtime.errno}`)
    }

    return textDecoder.decode(readCount === bytes.length ? bytes : bytes.subarray(0, readCount))
  } finally {
    core.close(fd)
  }
}

const readTextFile = async (path) => {
  if (isNodeRuntime()) {
    const { readFile } = await import('node:fs/promises')
    return await readFile(path, 'utf8')
  }

  return readTextFileInLo(path)
}

const readTextFileSync = (path) => {
  if (isNodeRuntime()) {
    const { readFileSync } = require('node:fs')
    return readFileSync(path, 'utf8')
  }

  return readTextFileInLo(path)
}

const readJsonFile = async (path) => JSON.parse(await readTextFile(path))
const readJsonFileSync = (path) => JSON.parse(readTextFileSync(path))

const pathExists = async (path) => {
  if (isNodeRuntime()) {
    const { access } = await import('node:fs/promises')

    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

  return globalThis.lo.core.access(path, globalThis.lo.core.F_OK) === 0
}

const pathExistsSync = (path) => {
  if (isNodeRuntime()) {
    const { existsSync } = require('node:fs')
    return existsSync(path)
  }

  return globalThis.lo.core.access(path, globalThis.lo.core.F_OK) === 0
}

const tryResolveExistingFile = async (path) => {
  const candidates = [
    `${path}.js`,
    `${path}.mjs`,
    `${path}.cjs`,
    joinPaths(path, 'index.js'),
    joinPaths(path, 'index.mjs'),
    joinPaths(path, 'index.cjs'),
    path,
  ]

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return null
}

const tryResolveExistingFileSync = (path) => {
  const candidates = [
    `${path}.js`,
    `${path}.mjs`,
    `${path}.cjs`,
    joinPaths(path, 'index.js'),
    joinPaths(path, 'index.mjs'),
    joinPaths(path, 'index.cjs'),
    path,
  ]

  for (const candidate of candidates) {
    if (pathExistsSync(candidate)) {
      return candidate
    }
  }

  return null
}

const selectPackageTarget = (target, mode = 'import') => {
  if (!target) {
    return null
  }

  if (typeof target === 'string') {
    return target
  }

  if (Array.isArray(target)) {
    for (const entry of target) {
      const selected = selectPackageTarget(entry, mode)

      if (selected) {
        return selected
      }
    }

    return null
  }

  if (typeof target === 'object') {
    return (
      selectPackageTarget(target.browser, mode) ??
      (mode === 'require'
        ? selectPackageTarget(target.require, mode)
        : selectPackageTarget(target.import, mode)) ??
      selectPackageTarget(target.default, mode) ??
      Object.values(target).reduce(
        (selected, entry) => selected ?? selectPackageTarget(entry, mode),
        null,
      )
    )
  }

  return null
}

const resolvePackageEntry = async (repoRoot, specifier) => {
  const { packageName, subpath } = parsePackageSpecifier(specifier)
  const packageRoot = joinPaths(repoRoot, 'node_modules', packageName)
  const packageJsonPath = joinPaths(packageRoot, 'package.json')
  const packageJson = await readJsonFile(packageJsonPath)
  const exportKey = subpath ? `./${subpath}` : '.'
  const exportTarget =
    packageJson.exports && typeof packageJson.exports === 'object'
      ? selectPackageTarget(
          packageJson.exports[exportKey] ?? (exportKey === '.' ? packageJson.exports : null),
          'import',
        )
      : typeof packageJson.exports === 'string'
        ? packageJson.exports
        : null
  const packageTarget =
    exportTarget ??
    (subpath ? subpath : null) ??
    packageJson.module ??
    (typeof packageJson.browser === 'string' ? packageJson.browser : null) ??
    packageJson.main ??
    'index.js'

  const normalizedTarget = packageTarget.startsWith('./')
    ? packageTarget.slice(2)
    : packageTarget
  const resolved = await tryResolveExistingFile(joinPaths(packageRoot, normalizedTarget))

  if (!resolved) {
    throw new Error(`could not resolve package entry for ${specifier}`)
  }

  return resolved
}

const resolvePackageEntrySync = (repoRoot, specifier) => {
  const { packageName, subpath } = parsePackageSpecifier(specifier)
  const packageRoot = joinPaths(repoRoot, 'node_modules', packageName)
  const packageJsonPath = joinPaths(packageRoot, 'package.json')
  const packageJson = readJsonFileSync(packageJsonPath)
  const exportKey = subpath ? `./${subpath}` : '.'
  const exportTarget =
    packageJson.exports && typeof packageJson.exports === 'object'
      ? selectPackageTarget(
          packageJson.exports[exportKey] ?? (exportKey === '.' ? packageJson.exports : null),
          'require',
        )
      : typeof packageJson.exports === 'string'
        ? packageJson.exports
        : null
  const packageTarget =
    exportTarget ??
    (subpath ? subpath : null) ??
    packageJson.main ??
    (typeof packageJson.browser === 'string' ? packageJson.browser : null) ??
    packageJson.module ??
    'index.js'

  const normalizedTarget = packageTarget.startsWith('./')
    ? packageTarget.slice(2)
    : packageTarget
  const resolved = tryResolveExistingFileSync(joinPaths(packageRoot, normalizedTarget))

  if (!resolved) {
    throw new Error(`could not resolve package entry for ${specifier}`)
  }

  return resolved
}

const resolveModulePath = async (input) => {
  const specifier = input.specifier

  if (specifier.startsWith('node:')) {
    return specifier
  }

  if (specifier.startsWith('file://')) {
    return await tryResolveExistingFile(fileUrlToPath(specifier))
  }

  if (specifier.startsWith('/')) {
    return await tryResolveExistingFile(specifier)
  }

  if (!isBareSpecifier(specifier)) {
    const baseResource = input.resource ? fileUrlToPath(input.resource) : input.runtimeRoot
    return await tryResolveExistingFile(resolvePath(dirname(baseResource), specifier))
  }

  return await resolvePackageEntry(input.repoRoot, specifier)
}

const resolveModulePathSync = (input) => {
  const specifier = input.specifier

  if (specifier.startsWith('node:')) {
    return specifier
  }

  if (specifier.startsWith('file://')) {
    return tryResolveExistingFileSync(fileUrlToPath(specifier))
  }

  if (specifier.startsWith('/')) {
    return tryResolveExistingFileSync(specifier)
  }

  if (!isBareSpecifier(specifier)) {
    const baseResource = input.resource ? fileUrlToPath(input.resource) : input.runtimeRoot
    return tryResolveExistingFileSync(resolvePath(dirname(baseResource), specifier))
  }

  return resolvePackageEntrySync(input.repoRoot, specifier)
}

const buildCommonJsInteropWrapperSource = (resolvedPath, namedExports) =>
  [
    `const mod = require(${JSON.stringify(resolvedPath)});`,
    'export default mod;',
    ...namedExports.map((name) => `export const ${name} = mod[${JSON.stringify(name)}];`),
  ].join('\n')

const rewriteRelativeImportSpecifiers = (source, resolvedPath) => {
  const rewrite = (specifier) =>
    resolvePath(dirname(resolvedPath), specifier)

  return source
    .replaceAll(importFromPattern, (_match, prefix, specifier, suffix) =>
      `${prefix}${rewrite(specifier)}${suffix}`,
    )
    .replaceAll(importBarePattern, (_match, prefix, specifier, suffix) =>
      `${prefix}${rewrite(specifier)}${suffix}`,
    )
    .replaceAll(importCallPattern, (_match, prefix, specifier, suffix) =>
      `${prefix}${rewrite(specifier)}${suffix}`,
    )
    .replaceAll(requireCallPattern, (_match, prefix, specifier, suffix) =>
      `${prefix}${rewrite(specifier)}${suffix}`,
    )
}

export const installSandboxModuleLoader = (input) => {
  if (!globalThis.lo?.core) {
    return
  }

  const runtimeRoot = normalizePath(input.runtimeRoot)
  const repoRoot = normalizePath(input.repoRoot)
  const previousLoader = globalThis.lo.core.loader
  const previousSyncLoader = globalThis.lo.core.sync_loader

  globalThis.__wonderlandsSandboxRuntime = {
    ...(globalThis.__wonderlandsSandboxRuntime ?? {}),
    repoRoot,
    runtimeRoot,
  }

  globalThis.lo.core.loader = async (specifier, resource) => {
    debugLog(`loader specifier=${specifier} resource=${String(resource ?? '')}`)

    if (specifier === 'node:zlib') {
      debugLog('loader stubbed node:zlib')
      return zlibStubSource
    }

    if (specifier === 'turndown') {
      debugLog('loader stubbed turndown')
      return turndownStubSource
    }

    try {
      const resolvedPath = await resolveModulePath({
        repoRoot,
        resource: typeof resource === 'string' ? resource : null,
        runtimeRoot,
        specifier,
      })

      if (!resolvedPath) {
        debugLog(`loader unresolved specifier=${specifier}`)
        return previousLoader ? await previousLoader(specifier, resource) : ''
      }

      if (hasOwn(commonJsNamedExportWrappers, specifier)) {
        debugLog(`loader wrapped commonjs specifier=${specifier} target=${resolvePackageEntrySync(repoRoot, specifier)}`)
        return buildCommonJsInteropWrapperSource(
          resolvePackageEntrySync(repoRoot, specifier),
          commonJsNamedExportWrappers[specifier],
        )
      }

      if (resolvedPath.startsWith('node:')) {
        if (resolvedPath === 'node:zlib') {
          return zlibStubSource
        }

        return previousLoader ? await previousLoader(resolvedPath, resource) : ''
      }

      const source = await readTextFile(resolvedPath)
      debugLog(`loader resolved specifier=${specifier} path=${resolvedPath}`)
      return rewriteRelativeImportSpecifiers(source, resolvedPath)
    } catch (error) {
      debugLog(`loader error specifier=${specifier} message=${error instanceof Error ? error.message : String(error)}`)
      if (previousLoader) {
        return await previousLoader(specifier, resource)
      }

      throw error
    }
  }

  globalThis.lo.core.sync_loader = (specifier, resource) => {
    debugLog(`sync_loader specifier=${specifier} resource=${String(resource ?? '')}`)

    if (specifier === 'node:zlib') {
      debugLog('sync_loader stubbed node:zlib')
      return zlibStubSource
    }

    if (specifier === 'turndown') {
      debugLog('sync_loader stubbed turndown')
      return turndownStubSource
    }

    try {
      const resolvedPath = resolveModulePathSync({
        repoRoot,
        resource: typeof resource === 'string' ? resource : null,
        runtimeRoot,
        specifier,
      })

      if (!resolvedPath) {
        debugLog(`sync_loader unresolved specifier=${specifier}`)
        return previousSyncLoader ? previousSyncLoader(specifier, resource) : ''
      }

      if (hasOwn(commonJsNamedExportWrappers, specifier)) {
        debugLog(
          `sync_loader wrapped commonjs specifier=${specifier} target=${resolvePackageEntrySync(repoRoot, specifier)}`,
        )
        return buildCommonJsInteropWrapperSource(
          resolvePackageEntrySync(repoRoot, specifier),
          commonJsNamedExportWrappers[specifier],
        )
      }

      if (resolvedPath.startsWith('node:')) {
        if (resolvedPath === 'node:zlib') {
          return zlibStubSource
        }

        return previousSyncLoader ? previousSyncLoader(resolvedPath, resource) : ''
      }

      const source = readTextFileSync(resolvedPath)
      debugLog(`sync_loader resolved specifier=${specifier} path=${resolvedPath}`)
      return rewriteRelativeImportSpecifiers(source, resolvedPath)
    } catch (error) {
      debugLog(`sync_loader error specifier=${specifier} message=${error instanceof Error ? error.message : String(error)}`)
      if (previousSyncLoader) {
        return previousSyncLoader(specifier, resource)
      }

      throw error
    }
  }
}
