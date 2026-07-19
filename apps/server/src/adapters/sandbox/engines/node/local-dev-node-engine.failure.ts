import type {
  SandboxRunFailure,
  SandboxRunFailureCode,
  SandboxRunFailureOrigin,
  SandboxRunFailurePhase,
} from '../../../../domain/sandbox/sandbox-runner'

const FAILURE_PREVIEW_LIMIT = 1200

const toPreview = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? ''

  if (trimmed.length === 0) {
    return null
  }

  return trimmed.length <= FAILURE_PREVIEW_LIMIT
    ? trimmed
    : `${trimmed.slice(0, FAILURE_PREVIEW_LIMIT)}…`
}

const classifyFailure = (input: {
  phase: SandboxRunFailurePhase
  requestedPackageCount: number
  stderrPreview: string | null
  stdoutPreview: string | null
}): {
  code: SandboxRunFailureCode
  hint: string | null
  origin: SandboxRunFailureOrigin
  retryable: boolean
} => {
  if (input.phase === 'package_install' && input.requestedPackageCount > 0) {
    return {
      code: 'SANDBOX_PACKAGE_INSTALL_FAILED',
      hint: 'This local_dev runner installs npm packages with --ignore-scripts. Packages that need install-time setup, postinstall hooks, or native binaries, such as sharp, may be blocked or fail here. Prefer pure-JS packages or a managed sandbox runner.',
      origin: 'control_plane',
      retryable: true,
    }
  }

  const combinedPreview = `${input.stderrPreview ?? ''}\n${input.stdoutPreview ?? ''}`.toLowerCase()

  if (
    combinedPreview.includes('syntaxerror:') &&
    /\n\s*(?:import|export)\s/m.test(`${input.stderrPreview ?? ''}\n${input.stdoutPreview ?? ''}`)
  ) {
    return {
      code: 'SANDBOX_VALIDATION_IMPORT_EXPORT_IN_SCRIPT_BODY',
      hint: 'This script body cannot use static top-level `import`/`export` syntax. Use `await import(...)` inside the script body instead, for example `const { default: sharp } = await import("sharp")` or `const { promises: fs } = await import("node:fs")`.',
      origin: 'guest',
      retryable: true,
    }
  }

  if (
    combinedPreview.includes('cannot find module') ||
    combinedPreview.includes('module not found') ||
    combinedPreview.includes('err_module_not_found')
  ) {
    return {
      code: 'SANDBOX_SCRIPT_IMPORT_FAILED',
      hint:
        input.requestedPackageCount > 0
          ? 'A requested package could not be loaded at runtime. In local_dev this usually means the package needs install-time setup or native binaries, such as sharp, and is incompatible with the active runner. Prefer a pure-JS package or a managed sandbox runner.'
          : 'A script import could not be loaded at runtime. Check the requested packages and script import paths.',
      origin: 'guest',
      retryable: true,
    }
  }

  if (
    combinedPreview.includes('require is not defined in es module scope') ||
    combinedPreview.includes('require is not defined')
  ) {
    return {
      code: 'SANDBOX_VALIDATION_REQUIRE_IN_ESM',
      hint: 'The inline script is running as an ES module. Use `await import(...)` instead of `require(...)`, or provide a `.cjs` filename when the script must run as CommonJS.',
      origin: 'guest',
      retryable: true,
    }
  }

  if (
    combinedPreview.includes('illegal return statement') ||
    combinedPreview.includes('return statement is not allowed here')
  ) {
    return {
      code: 'SANDBOX_VALIDATION_TOP_LEVEL_RETURN',
      hint: 'Do not use top-level `return` in inline script mode. Use top-level await for the work, then print the final result with `console.log(JSON.stringify(result))`.',
      origin: 'guest',
      retryable: true,
    }
  }

  if (combinedPreview.includes('enoent') || combinedPreview.includes('no such file or directory')) {
    return {
      code: 'SANDBOX_PATH_NOT_MOUNTED',
      hint: 'The script referenced a path that is not present in the sandbox. Mount it first with attachments, garden, vaultInputs, or cwdVaultPath.',
      origin: 'guest',
      retryable: true,
    }
  }

  if (
    combinedPreview.includes('permission denied') ||
    combinedPreview.includes('access to this api has been restricted') ||
    combinedPreview.includes('err_access_denied')
  ) {
    return {
      code: 'SANDBOX_PERMISSION_DENIED',
      hint:
        input.requestedPackageCount > 0
          ? 'The script attempted an operation blocked by sandbox permissions or the Node permission model. In local_dev, requested packages that rely on native addons or install-time setup, such as sharp, may fail at runtime; prefer pure-JS packages or a managed sandbox runner.'
          : 'The script attempted an operation blocked by sandbox permissions or the Node permission model.',
      origin: 'guest',
      retryable: true,
    }
  }

  return {
    code:
      input.phase === 'runner_setup'
        ? 'SANDBOX_RUNNER_SETUP_FAILED'
        : input.phase === 'package_install'
          ? 'SANDBOX_PACKAGE_INSTALL_FAILED'
          : 'SANDBOX_GUEST_EXIT_NON_ZERO',
    hint: null,
    origin: input.phase === 'script_execution' ? 'guest' : 'control_plane',
    retryable: input.phase !== 'runner_setup',
  }
}

const formatFailureSummary = (input: {
  exitCode: number | null
  hint: string | null
  phase: SandboxRunFailurePhase
}): string => {
  const parts = [
    `Sandbox ${input.phase.replaceAll('_', ' ')} failed`,
    input.exitCode !== null ? `with exit code ${input.exitCode}` : null,
  ].filter((value): value is string => value !== null)

  return input.hint ? `${parts.join(' ')}. ${input.hint}` : parts.join(' ')
}

const toFailure = (input: {
  code?: SandboxRunFailureCode
  exitCode: number | null
  hint?: string | null
  message?: string
  nextAction?: string | null
  origin?: SandboxRunFailureOrigin
  phase: SandboxRunFailurePhase
  requestedPackageCount: number
  retryable?: boolean
  signal: string | null
  stderrText: string | null
  stdoutText: string | null
}): SandboxRunFailure => {
  const stderrPreview = toPreview(input.stderrText)
  const stdoutPreview = toPreview(input.stdoutText)
  const classified = classifyFailure({
    phase: input.phase,
    requestedPackageCount: input.requestedPackageCount,
    stderrPreview,
    stdoutPreview,
  })
  const hint = input.hint ?? classified.hint

  return {
    code: input.code ?? classified.code,
    exitCode: input.exitCode,
    hint,
    message:
      input.message ??
      formatFailureSummary({
        exitCode: input.exitCode,
        hint,
        phase: input.phase,
      }),
    nextAction: input.nextAction ?? hint,
    origin: input.origin ?? classified.origin,
    phase: input.phase,
    retryable: input.retryable ?? classified.retryable,
    runner: 'local_dev',
    signal: input.signal,
    stderrPreview,
    stdoutPreview,
    summary: formatFailureSummary({
      exitCode: input.exitCode,
      hint,
      phase: input.phase,
    }),
  }
}

export { classifyFailure, formatFailureSummary, toFailure, toPreview }
