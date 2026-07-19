import type { ValidatedSandboxJobRequest } from './sandbox-policy'

const toSandboxBashNetworkConfig = (
  network: ValidatedSandboxJobRequest['request']['network'],
): Record<string, unknown> | undefined => {
  if (network.mode === 'off') {
    return undefined
  }

  if (network.mode === 'open') {
    return {
      dangerouslyAllowFullInternetAccess: true,
    }
  }

  const allowedHosts = network.allowedHosts ?? []

  return allowedHosts.length > 0
    ? {
        allowedUrlPrefixes: allowedHosts.flatMap((host) => [`https://${host}`, `http://${host}`]),
      }
    : undefined
}

export const buildSandboxBashWrapperScript = (input: {
  cwd: string
  env?: Record<string, string>
  mountVault: boolean
  network: ValidatedSandboxJobRequest['request']['network']
  script?: string
  scriptPath?: string
  stdin?: string
  vaultWritable: boolean
}): string => {
  const networkConfig = toSandboxBashNetworkConfig(input.network)
  const scriptLoader =
    typeof input.scriptPath === 'string'
      ? `const scriptSource = await fs.readFile(${JSON.stringify(input.scriptPath)}, "utf8");`
      : `const scriptSource = ${JSON.stringify(input.script ?? '')};`

  return `
import { Bash, InMemoryFs, MountableFs, OverlayFs, ReadWriteFs } from "just-bash";

const fs = new MountableFs({ base: new InMemoryFs() });
fs.mount("/input", new OverlayFs({ root: "/input", mountPoint: "/", readOnly: true }));
fs.mount("/work", new ReadWriteFs({ root: "/work" }));
fs.mount("/output", new ReadWriteFs({ root: "/output" }));
${input.mountVault ? `fs.mount("/vault", new ${input.vaultWritable ? 'ReadWriteFs' : 'OverlayFs'}({ root: "/vault"${input.vaultWritable ? '' : ', mountPoint: "/", readOnly: true'} }));` : ''}

const bash = new Bash({
  fs,
  cwd: ${JSON.stringify(input.cwd)},
  ${networkConfig ? `network: ${JSON.stringify(networkConfig)},` : ''}
});

try {
  ${scriptLoader}
  const result = await bash.exec(scriptSource, {
    ${input.env ? `env: ${JSON.stringify(input.env)},` : ''}
    ${input.stdin !== undefined ? `stdin: ${JSON.stringify(input.stdin)},` : ''}
    rawScript: true,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
} catch (error) {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(\`\${text}\\n\`);
  process.exitCode = 1;
}
`.trim()
}

const dirnameOfSandboxPath = (value: string): string => {
  const trimmed = value.trim()

  if (trimmed === '/' || trimmed.length === 0) {
    return '/'
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '')
  const lastSlashIndex = withoutTrailingSlash.lastIndexOf('/')

  if (lastSlashIndex <= 0) {
    return '/'
  }

  return withoutTrailingSlash.slice(0, lastSlashIndex)
}

export const wrapBashRequestForNodeCompat = (input: {
  request: ValidatedSandboxJobRequest['request']
  stdin?: string
  vaultWritable: boolean
}): ValidatedSandboxJobRequest['request'] => {
  const mountVault =
    (input.request.vaultInputs?.length ?? 0) > 0 || typeof input.request.cwdVaultPath === 'string'
  const cwd =
    input.request.cwdVaultPath ??
    (input.request.source.kind === 'workspace_script'
      ? dirnameOfSandboxPath(input.request.source.vaultPath)
      : '/work')

  return {
    ...input.request,
    source: {
      filename: 'execute-bash.mjs',
      kind: 'inline_script',
      script: buildSandboxBashWrapperScript({
        cwd,
        env: input.request.env,
        mountVault,
        network: input.request.network,
        ...(input.request.source.kind === 'inline_script'
          ? { script: input.request.source.script }
          : { scriptPath: input.request.source.vaultPath }),
        stdin: input.stdin,
        vaultWritable: input.vaultWritable,
      }),
    },
  }
}
