import {
  dirname,
  joinPaths,
  normalizePath,
  relativeToRoot,
  resolvePath,
} from '../bootstrap/path-utils.mjs'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const optionalIgnoreFileNames = new Set(['.gitignore', '.ignore', '.rgignore'])

const isNodeRuntime = () => Boolean(globalThis.process?.versions?.node)

const fromUint8Array = (value, encoding) => {
  if (encoding === 'base64') {
    let binary = ''

    for (let offset = 0; offset < value.length; offset += 65_536) {
      const chunk = value.subarray(offset, offset + 65_536)
      binary += String.fromCharCode(...chunk)
    }

    return btoa(binary)
  }

  if (encoding === 'hex') {
    return Array.from(value)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  if (encoding === 'ascii' || encoding === 'binary' || encoding === 'latin1') {
    let result = ''

    for (let offset = 0; offset < value.length; offset += 65_536) {
      const chunk = value.subarray(offset, offset + 65_536)
      result += String.fromCharCode(...chunk)
    }

    return result
  }

  return textDecoder.decode(value)
}

const toUint8Array = (value, encoding) => {
  if (value instanceof Uint8Array) {
    return value
  }

  if (encoding === 'base64') {
    return Uint8Array.from(atob(String(value)), (character) => character.charCodeAt(0))
  }

  if (encoding === 'hex') {
    const text = String(value)
    const bytes = new Uint8Array(text.length / 2)

    for (let index = 0; index < text.length; index += 2) {
      bytes[index / 2] = parseInt(text.slice(index, index + 2), 16)
    }

    return bytes
  }

  if (encoding === 'ascii' || encoding === 'binary' || encoding === 'latin1') {
    return Uint8Array.from(String(value), (character) => character.charCodeAt(0))
  }

  if (encoding && encoding !== 'utf8' && encoding !== 'utf-8') {
    throw new Error(`unsupported encoding ${encoding}`)
  }

  return textEncoder.encode(String(value))
}

const createNodeAdapter = async () => {
  const fs = await import('node:fs/promises')

  return {
    chmod: async (path, mode) => {
      await fs.chmod(path, mode)
    },
    exists: async (path) => {
      try {
        await fs.access(path)
        return true
      } catch {
        return false
      }
    },
    mkdir: async (path, recursive) => {
      await fs.mkdir(path, { recursive })
    },
    readBuffer: async (path) => new Uint8Array(await fs.readFile(path)),
    readdir: async (path) =>
      (await fs.readdir(path, { withFileTypes: true })).map((entry) => ({
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymbolicLink: entry.isSymbolicLink(),
        name: entry.name,
      })),
    readlink: async (path) => await fs.readlink(path, 'utf8'),
    realpath: async (path) => await fs.realpath(path, 'utf8'),
    rename: async (sourcePath, targetPath) => {
      await fs.rename(sourcePath, targetPath)
    },
    rmdir: async (path) => {
      await fs.rmdir(path)
    },
    stat: async (path, followSymlinks) => {
      const stat = followSymlinks ? await fs.stat(path) : await fs.lstat(path)
      return {
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        isSymbolicLink: stat.isSymbolicLink(),
        mode: stat.mode,
        mtime: stat.mtime,
        size: stat.size,
      }
    },
    symlink: async (target, linkPath) => {
      await fs.symlink(target, linkPath)
    },
    unlink: async (path) => {
      await fs.unlink(path)
    },
    writeBuffer: async (path, bytes) => {
      await fs.writeFile(path, bytes)
    },
  }
}

const createLoAdapter = () => {
  const runtime = globalThis.lo
  const core = runtime.core
  const modeWord =
    core.os === 'linux' && core.arch === 'arm64'
      ? 4
      : core.os === 'mac'
        ? 1
        : 6

  const createStatBuffers = () => {
    const bytes = runtime.ptr(new Uint8Array(160))
    return {
      bytes,
      u32: new Uint32Array(bytes.buffer),
      u64: new BigUint64Array(bytes.buffer),
    }
  }

  const asLoPromise = (operation) => Promise.resolve().then(operation)

  const readDirEntry = (pointer) => {
    const header = runtime.ptr(new Uint8Array(21))
    const view = new DataView(header.buffer)

    if (core.os === 'mac') {
      runtime.readMemory(header.ptr, pointer, 21)
      const nameLength = view.getUint16(18, true)
      const entryType = header[20]
      const name = runtime.utf8Decode(pointer + 21, core.strnlen(pointer + 21, nameLength))
      return { entryType, name }
    }

    runtime.readMemory(header.ptr, pointer, 19)
    const entryType = header[18]
    const name = runtime.utf8Decode(pointer + 19, core.strnlen(pointer + 19, core.NAME_MAX))
    return { entryType, name }
  }

  const toStatRecord = (buffers) => {
    const mode = buffers.u32[modeWord]
    const size = core.os === 'mac' ? Number(buffers.u64[12]) : Number(buffers.u64[6])

    return {
      isDirectory: (mode & core.S_IFMT) === core.S_IFDIR,
      isFile: (mode & core.S_IFMT) === core.S_IFREG,
      isSymbolicLink: (mode & core.S_IFMT) === core.S_IFLNK,
      mode,
      mtime: new Date(0),
      size,
    }
  }

  const readErrno = () => Number(runtime.errno ?? 0)

  const toReadError = (path) => {
    const errno = readErrno()

    if (errno === 2) {
      return new Error(`ENOENT: no such file or directory, open '${path}'`)
    }

    if (errno === 21) {
      return new Error(`EISDIR: illegal operation on a directory, read '${path}'`)
    }

    return new Error(`read failed for ${path}: errno ${errno}`)
  }

  const toWriteError = (path) => {
    const errno = readErrno()

    if (errno === 2) {
      return new Error(`ENOENT: no such file or directory, open '${path}'`)
    }

    if (errno === 21) {
      return new Error(`EISDIR: illegal operation on a directory, write '${path}'`)
    }

    return new Error(`write failed for ${path}: errno ${errno}`)
  }

  const readBuffer = (path) => {
    const statBuffers = createStatBuffers()
    const fd = core.open(path, core.defaultReadFlags, 0)

    if (fd < 0) {
      throw toReadError(path)
    }

    try {
      if (core.fstat(fd, statBuffers.bytes.ptr) !== 0) {
        throw new Error(`stat failed for ${path}: errno ${readErrno()}`)
      }

      const size = core.os === 'mac' ? Number(statBuffers.u64[12]) : Number(statBuffers.u64[6])

      if (size <= 0) {
        return new Uint8Array()
      }

      const bytes = runtime.ptr(new Uint8Array(size))
      let offset = 0

      while (offset < size) {
        const chunkSize = size - offset
        const readCount = core.read2(fd, bytes.ptr + offset, chunkSize)

        if (readCount < 0) {
          throw toReadError(path)
        }

        if (readCount === 0) {
          break
        }

        offset += readCount
      }

      return offset === bytes.length ? bytes : bytes.subarray(0, offset)
    } finally {
      core.close(fd)
    }
  }

  const writeBuffer = (path, bytes) => {
    if (!bytes.ptr) {
      runtime.ptr(bytes)
    }

    const fd = core.open(path, core.defaultWriteFlags, core.defaultWriteMode)

    if (fd < 0) {
      throw toWriteError(path)
    }

    try {
      let offset = 0

      while (offset < bytes.length) {
        const written = core.write2(fd, bytes.ptr + offset, bytes.length - offset)

        if (written <= 0) {
          throw toWriteError(path)
        }

        offset += written
      }
    } finally {
      core.close(fd)
    }
  }

  return {
    chmod: () =>
      asLoPromise(() => {
      throw new Error('chmod is not available in the lo sandbox runtime')
      }),
    exists: (path) => asLoPromise(() => core.access(path, core.F_OK) === 0),
    mkdir: (path) =>
      asLoPromise(() => {
      if (core.mkdir(path, core.S_IRWXU | core.S_IRWXG | core.S_IROTH) !== 0) {
        throw new Error(`mkdir failed for ${path}: errno ${runtime.errno}`)
      }
      }),
    readBuffer: (path) => asLoPromise(() => readBuffer(path)),
    readdir: (path) =>
      asLoPromise(() => {
      const dir = core.opendir(path)

      if (!dir) {
        throw new Error(`opendir failed for ${path}: errno ${runtime.errno}`)
      }

      const entries = []
      let next = core.readdir(dir)

      while (next) {
        const entry = readDirEntry(next)

        if (entry.name !== '.' && entry.name !== '..') {
          entries.push({
            isDirectory: entry.entryType === core.DT_DIR,
            isFile: entry.entryType === core.DT_REG,
            isSymbolicLink: entry.entryType === core.DT_LNK,
            name: entry.name,
          })
        }

        next = core.readdir(dir)
      }

      core.closedir(dir)
      return entries
      }),
    readlink: (path) =>
      asLoPromise(() => {
      const buffer = runtime.ptr(new Uint8Array(4096))
      const length = core.readlink(path, buffer, 4096)

      if (length < 0) {
        throw new Error(`readlink failed for ${path}: errno ${runtime.errno}`)
      }

      return runtime.utf8Decode(buffer.ptr ?? buffer, length)
      }),
    realpath: () =>
      asLoPromise(() => {
      throw new Error('realpath is not available in the lo sandbox runtime')
      }),
    rename: (sourcePath, targetPath) =>
      asLoPromise(() => {
      if (core.rename(sourcePath, targetPath) !== 0) {
        throw new Error(`rename failed for ${sourcePath}: errno ${runtime.errno}`)
      }
      }),
    rmdir: (path) =>
      asLoPromise(() => {
      if (core.rmdir(path) !== 0) {
        throw new Error(`rmdir failed for ${path}: errno ${runtime.errno}`)
      }
      }),
    stat: (path, followSymlinks) =>
      asLoPromise(() => {
      const buffers = createStatBuffers()
      const result = followSymlinks
        ? core.stat(path, buffers.bytes.ptr)
        : core.lstat(path, buffers.bytes.ptr)

      if (result !== 0) {
        throw new Error(`stat failed for ${path}: errno ${runtime.errno}`)
      }

      return toStatRecord(buffers)
      }),
    symlink: (target, linkPath) =>
      asLoPromise(() => {
      if (core.symlink(target, linkPath) !== 0) {
        throw new Error(`symlink failed for ${linkPath}: errno ${runtime.errno}`)
      }
      }),
    unlink: (path) =>
      asLoPromise(() => {
      if (core.unlink(path) !== 0) {
        throw new Error(`unlink failed for ${path}: errno ${runtime.errno}`)
      }
      }),
    writeBuffer: (path, bytes) =>
      asLoPromise(() => {
        writeBuffer(path, bytes)
      }),
  }
}

const createHostAdapter = async () =>
  (isNodeRuntime() ? await createNodeAdapter() : createLoAdapter())

const isReadOnlyPath = (path, readOnlyRoots) =>
  readOnlyRoots.some((root) => path === root || path.startsWith(`${root}/`))

export class SandboxHostFs {
  static async create(options) {
    const adapter = await createHostAdapter()
    return new SandboxHostFs(options, adapter)
  }

  constructor(options, adapter) {
    this.adapter = adapter
    this.hostRoot = normalizePath(options.hostRoot)
    this.readOnlyRoots = Array.from(
      new Set((options.readOnlyRoots ?? []).map((root) => normalizePath(root))),
    )
  }

  resolvePath(base, path) {
    return resolvePath(base, path)
  }

  toSandboxPath(hostPath) {
    const relativePath = relativeToRoot(this.hostRoot, normalizePath(hostPath))
    return normalizePath(`/${relativePath}`)
  }

  toHostPath(path) {
    const sandboxPath = normalizePath(path)
    const relativePath = relativeToRoot('/', sandboxPath)
    return relativePath.length > 0 ? joinPaths(this.hostRoot, relativePath) : this.hostRoot
  }

  assertWritable(path) {
    const sandboxPath = normalizePath(path)

    if (isReadOnlyPath(sandboxPath, this.readOnlyRoots)) {
      throw new Error(`path ${sandboxPath} is read-only in this sandbox`)
    }
  }

  async ensureParentDirectory(path) {
    const parent = dirname(path)

    if (parent !== '.' && parent !== '/') {
      await this.mkdir(parent, { recursive: true })
    }
  }

  async readFile(path, options) {
    let bytes

    try {
      bytes = await this.readFileBuffer(path)
    } catch (error) {
      const fileName = normalizePath(path).split('/').pop() ?? ''
      const message = error instanceof Error ? error.message : String(error)

      if (optionalIgnoreFileNames.has(fileName) && message.startsWith('ENOENT:')) {
        return ''
      }

      throw error
    }

    const encoding =
      typeof options === 'string'
        ? options
        : options?.encoding ?? 'utf8'

    return fromUint8Array(bytes, encoding)
  }

  async readFileBuffer(path) {
    return await this.adapter.readBuffer(this.toHostPath(path))
  }

  async writeFile(path, content, options) {
    this.assertWritable(path)
    await this.ensureParentDirectory(path)
    await this.adapter.writeBuffer(
      this.toHostPath(path),
      toUint8Array(content, typeof options === 'string' ? options : options?.encoding),
    )
  }

  async appendFile(path, content, options) {
    const existing = (await this.exists(path)) ? await this.readFileBuffer(path) : new Uint8Array()
    const appended = toUint8Array(content, typeof options === 'string' ? options : options?.encoding)
    const merged = new Uint8Array(existing.length + appended.length)
    merged.set(existing, 0)
    merged.set(appended, existing.length)
    await this.writeFile(path, merged)
  }

  async exists(path) {
    return await this.adapter.exists(this.toHostPath(path))
  }

  async stat(path) {
    return await this.adapter.stat(this.toHostPath(path), true)
  }

  async lstat(path) {
    return await this.adapter.stat(this.toHostPath(path), false)
  }

  async mkdir(path, options = {}) {
    this.assertWritable(path)

    if (!options.recursive) {
      await this.adapter.mkdir(this.toHostPath(path), false)
      return
    }

    const segments = normalizePath(path).split('/').filter(Boolean)
    let current = '/'

    for (const segment of segments) {
      current = current === '/' ? `/${segment}` : `${current}/${segment}`

      if (!(await this.exists(current))) {
        this.assertWritable(current)
        await this.adapter.mkdir(this.toHostPath(current), false)
      }
    }
  }

  async readdir(path) {
    return (await this.adapter.readdir(this.toHostPath(path))).map((entry) => entry.name)
  }

  async readdirWithFileTypes(path) {
    return await this.adapter.readdir(this.toHostPath(path))
  }

  async rm(path, options = {}) {
    this.assertWritable(path)
    const stat = options.force && !(await this.exists(path)) ? null : await this.lstat(path)

    if (!stat) {
      return
    }

    if (stat.isDirectory) {
      const entries = await this.readdir(path)

      if (entries.length > 0 && !options.recursive) {
        throw new Error(`directory ${path} is not empty`)
      }

      for (const entry of entries) {
        await this.rm(joinPaths(path, entry), options)
      }

      await this.adapter.rmdir(this.toHostPath(path))
      return
    }

    await this.adapter.unlink(this.toHostPath(path))
  }

  async cp(sourcePath, targetPath, options = {}) {
    const sourceStat = await this.lstat(sourcePath)

    if (sourceStat.isDirectory) {
      if (!options.recursive) {
        throw new Error(`cp requires recursive option for directory ${sourcePath}`)
      }

      await this.mkdir(targetPath, { recursive: true })

      for (const entry of await this.readdir(sourcePath)) {
        await this.cp(joinPaths(sourcePath, entry), joinPaths(targetPath, entry), options)
      }

      return
    }

    if (sourceStat.isSymbolicLink) {
      this.assertWritable(targetPath)
      await this.ensureParentDirectory(targetPath)
      await this.adapter.symlink(await this.readlink(sourcePath), this.toHostPath(targetPath))
      return
    }

    await this.writeFile(targetPath, await this.readFileBuffer(sourcePath))
  }

  async mv(sourcePath, targetPath) {
    this.assertWritable(sourcePath)
    this.assertWritable(targetPath)
    await this.ensureParentDirectory(targetPath)

    try {
      await this.adapter.rename(this.toHostPath(sourcePath), this.toHostPath(targetPath))
    } catch {
      await this.cp(sourcePath, targetPath, { recursive: true })
      await this.rm(sourcePath, { force: false, recursive: true })
    }
  }

  getAllPaths() {
    return []
  }

  async chmod(path, mode) {
    this.assertWritable(path)
    await this.adapter.chmod(this.toHostPath(path), mode)
  }

  async symlink(target, linkPath) {
    this.assertWritable(linkPath)
    await this.ensureParentDirectory(linkPath)
    await this.adapter.symlink(target, this.toHostPath(linkPath))
  }

  async link() {
    throw new Error('hard links are not supported in the lo sandbox runtime')
  }

  async readlink(path) {
    return await this.adapter.readlink(this.toHostPath(path))
  }

  async realpath(path) {
    try {
      return this.toSandboxPath(await this.adapter.realpath(this.toHostPath(path)))
    } catch {
      return normalizePath(path)
    }
  }
}
