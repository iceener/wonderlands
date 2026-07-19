import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type { SandboxExecutionRequest } from '../../../../domain/sandbox/types'

export const PATH_SHIM_FILENAME = '.sandbox-path-shim.cjs'

const toInlineScriptFilename = (filename: string | undefined): string => {
  if (!filename) {
    return 'sandbox-task.mjs'
  }

  return filename.endsWith('.js') || filename.endsWith('.mjs') || filename.endsWith('.cjs')
    ? filename
    : `${filename}.mjs`
}

const toHostPath = (hostRoot: string, sandboxPath: string): string =>
  join(hostRoot, sandboxPath.replace(/^\/+/, ''))

const ensureWithinRoot = (root: string, relativePath: string, label: string): string => {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, relativePath)
  const pathFromRoot = relative(resolvedRoot, resolvedPath).replace(/\\/g, '/')

  if (pathFromRoot === '..' || pathFromRoot.startsWith('../') || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} ${relativePath} escapes the sandbox work directory`)
  }

  return resolvedPath
}

const toInlineEntryHostPath = (workRootRef: string, filename: string | undefined): string =>
  ensureWithinRoot(workRootRef, toInlineScriptFilename(filename), 'inline script filename')

const toSandboxRoot = (value: string): string | null => {
  const trimmed = value.trim()

  if (!trimmed.startsWith('/')) {
    return null
  }

  const segments = trimmed.split('/').filter(Boolean)
  return segments.length > 0 ? `/${segments[0]}` : '/'
}

const collectSandboxRoots = (request: SandboxExecutionRequest): string[] => {
  const roots = new Set<string>(['/input', '/work', '/output', '/vault', '/tmp'])

  const register = (value: string | undefined) => {
    if (!value) {
      return
    }

    const root = toSandboxRoot(value)

    if (root) {
      roots.add(root)
    }
  }

  for (const attachment of request.attachments ?? []) {
    register(attachment.mountPath)
  }

  for (const input of request.vaultInputs ?? []) {
    register(input.mountPath)
  }

  for (const writeback of request.outputs?.writeBack ?? []) {
    if ('fromPath' in writeback) {
      register(writeback.fromPath)
    }
  }

  for (const pattern of request.outputs?.attachGlobs ?? []) {
    register(pattern)
  }

  register(request.cwdVaultPath)

  if (request.source.kind === 'workspace_script') {
    register(request.source.vaultPath)
  }

  return Array.from(roots)
}

export const buildPathShim = (hostRootRef: string, sandboxRoots: string[]): string =>
  `
const path = require('node:path');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const { syncBuiltinESMExports } = require('node:module');

const hostRoot = ${JSON.stringify(hostRootRef)};
const sandboxRoots = ${JSON.stringify(sandboxRoots)};

const remap = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  for (const root of sandboxRoots) {
    if (value === root || value.startsWith(root + '/')) {
      return path.join(hostRoot, value.replace(/^\\/+/, ''));
    }
  }

  return value;
};

const wrapOnePath = (target, key) => {
  if (typeof target[key] !== 'function') {
    return;
  }

  const original = target[key];
  target[key] = function (...args) {
    if (args.length > 0) {
      args[0] = remap(args[0]);
    }
    return original.apply(this, args);
  };
};

const wrapTwoPaths = (target, key) => {
  if (typeof target[key] !== 'function') {
    return;
  }

  const original = target[key];
  target[key] = function (...args) {
    if (args.length > 0) {
      args[0] = remap(args[0]);
    }
    if (args.length > 1) {
      args[1] = remap(args[1]);
    }
    return original.apply(this, args);
  };
};

[
  'access',
  'appendFile',
  'chmod',
  'chown',
  'existsSync',
  'lstat',
  'lstatSync',
  'mkdir',
  'mkdirSync',
  'open',
  'openSync',
  'opendir',
  'opendirSync',
  'readdir',
  'readdirSync',
  'readFile',
  'readFileSync',
  'readlink',
  'readlinkSync',
  'realpath',
  'realpathSync',
  'rm',
  'rmSync',
  'stat',
  'statSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'utimes',
  'utimesSync',
  'watch',
  'writeFile',
  'writeFileSync',
].forEach((key) => {
  wrapOnePath(fs, key);
  wrapOnePath(fsPromises, key);
});

[
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'link',
  'linkSync',
  'rename',
  'renameSync',
  'symlink',
  'symlinkSync',
].forEach((key) => {
  wrapTwoPaths(fs, key);
  wrapTwoPaths(fsPromises, key);
});

const originalChdir = process.chdir.bind(process);
process.chdir = (directory) => originalChdir(remap(directory));
syncBuiltinESMExports();
`.trim()

export { collectSandboxRoots, ensureWithinRoot, toHostPath, toInlineEntryHostPath }
