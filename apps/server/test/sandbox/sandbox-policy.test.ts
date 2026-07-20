import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import {
  parseSandboxPolicyJson,
  validateRunSandboxJobArgs,
  validateSandboxExecutionRequest,
} from '../../src/application/sandbox/sandbox-policy'

type PolicyCase = { name: string; run: () => void }
const runtimePolicyCases: PolicyCase[] = []
const sourcePolicyCases: PolicyCase[] = []
const runtimePolicyCase = (name: string, run: () => void) => runtimePolicyCases.push({ name, run })
const sourcePolicyCase = (name: string, run: () => void) => sourcePolicyCases.push({ name, run })

const runPolicyMatrix = (cases: PolicyCase[]) => {
  for (const policyCase of cases) {
    assert.doesNotThrow(policyCase.run, policyCase.name)
  }
}

describe('sandbox policy validation', () => {
  sourcePolicyCase('normalizes registry hosts and vault roots', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      network: {
        allowedHosts: ['HTTPS://Registry.npmjs.org/', 'registry.npmjs.org'],
        mode: 'allow_list',
      },
      packages: {
        allowedRegistries: ['https://REGISTRY.npmjs.org/', 'registry.npmjs.org/'],
        mode: 'allow_list',
      },
      vault: {
        allowedRoots: ['vault/projects/demo/', '/vault/projects/demo'],
        mode: 'read_write',
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    assert.deepEqual(parsed.value.network.allowedHosts, ['registry.npmjs.org'])
    assert.deepEqual(parsed.value.packages.allowedRegistries, ['registry.npmjs.org'])
    assert.deepEqual(parsed.value.vault.allowedRoots, ['/vault/projects/demo'])
  })

  runtimePolicyCase('parses sandbox engine policy and shell command allow list', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      packages: {
        allowedPackages: [
          {
            name: 'csv-parse',
            runtimes: ['lo', 'node'],
            versionRange: '5.6.0',
          },
        ],
        mode: 'allow_list',
      },
      runtime: {
        allowAutomaticCompatFallback: true,
        allowedEngines: ['lo', 'node'],
        defaultEngine: 'lo',
      },
      shell: {
        allowedCommands: ['find', 'grep', 'find'],
      },
      vault: {
        mode: 'read_only',
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    assert.equal(parsed.value.runtime.defaultEngine, 'lo')
    assert.deepEqual(parsed.value.runtime.allowedEngines, ['lo', 'node'])
    assert.equal(parsed.value.runtime.allowAutomaticCompatFallback, true)
    assert.deepEqual(parsed.value.packages.allowedPackages, [
      {
        allowInstallScripts: false,
        name: 'csv-parse',
        runtimes: ['lo', 'node'],
        versionRange: '5.6.0',
      },
    ])
    assert.deepEqual(parsed.value.shell?.allowedCommands, ['find', 'grep'])
  })

  runtimePolicyCase('rejects automatic compat fallback when node is not allowed', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      runtime: {
        allowAutomaticCompatFallback: true,
        allowedEngines: ['lo'],
        defaultEngine: 'lo',
      },
      vault: {
        mode: 'read_only',
      },
    })

    assert.equal(parsed.ok, false)

    if (parsed.ok) {
      throw new Error('expected sandbox policy parse to fail')
    }

    assert.match(parsed.error.message, /allowAutomaticCompatFallback/)
  })

  runtimePolicyCase('selects the default lo runtime when the policy allows it', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      runtime: {
        allowedEngines: ['lo', 'node'],
        defaultEngine: 'lo',
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    const validated = validateSandboxExecutionRequest(parsed.value, {
      source: {
        kind: 'inline_script',
        script: 'console.log("hi")',
      },
      task: 'Run inline script',
    })

    assert.equal(validated.ok, true)

    if (!validated.ok) {
      throw new Error('expected sandbox request to validate')
    }

    assert.equal(validated.value.request.runtime, 'lo')
  })

  runtimePolicyCase(
    'falls back to node when a requested package is node-only and compat fallback is enabled',
    () => {
      const parsed = parseSandboxPolicyJson({
        enabled: true,
        network: {
          mode: 'open',
        },
        packages: {
          allowedPackages: [
            {
              name: 'legacy-node-lib',
              runtimes: ['node'],
              versionRange: '1.2.3',
            },
          ],
          mode: 'allow_list',
        },
        runtime: {
          allowAutomaticCompatFallback: true,
          allowedEngines: ['lo', 'node'],
          defaultEngine: 'lo',
        },
      })

      assert.equal(parsed.ok, true)

      if (!parsed.ok) {
        throw new Error('expected sandbox policy to parse')
      }

      const validated = validateSandboxExecutionRequest(parsed.value, {
        network: {
          mode: 'on',
        },
        packages: [
          {
            name: 'legacy-node-lib',
            version: '1.2.3',
          },
        ],
        source: {
          kind: 'inline_script',
          script: 'console.log("hi")',
        },
        task: 'Install package',
      })

      assert.equal(validated.ok, true)

      if (!validated.ok) {
        throw new Error('expected sandbox request to validate')
      }

      assert.equal(validated.value.request.runtime, 'node')
    },
  )

  runtimePolicyCase(
    'falls back to node when packages are requested and lo package execution is not wired yet',
    () => {
      const parsed = parseSandboxPolicyJson({
        enabled: true,
        network: {
          mode: 'open',
        },
        packages: {
          allowedPackages: [
            {
              name: 'csv-parse',
              runtimes: ['lo', 'node'],
              versionRange: '5.6.0',
            },
          ],
          mode: 'allow_list',
        },
        runtime: {
          allowAutomaticCompatFallback: true,
          allowedEngines: ['lo', 'node'],
          defaultEngine: 'lo',
        },
      })

      assert.equal(parsed.ok, true)

      if (!parsed.ok) {
        throw new Error('expected sandbox policy to parse')
      }

      const validated = validateSandboxExecutionRequest(parsed.value, {
        network: {
          mode: 'on',
        },
        packages: [
          {
            name: 'csv-parse',
            version: '5.6.0',
          },
        ],
        source: {
          kind: 'inline_script',
          script: 'console.log("hi")',
        },
        task: 'Install package',
      })

      assert.equal(validated.ok, true)

      if (!validated.ok) {
        throw new Error('expected sandbox request to validate')
      }

      assert.equal(validated.value.request.runtime, 'node')
    },
  )

  runtimePolicyCase(
    'rejects package-backed jobs for lo-only policies until lo package execution exists',
    () => {
      const parsed = parseSandboxPolicyJson({
        enabled: true,
        network: {
          mode: 'open',
        },
        packages: {
          allowedPackages: [
            {
              name: 'csv-parse',
              runtimes: ['lo'],
              versionRange: '5.6.0',
            },
          ],
          mode: 'allow_list',
        },
        runtime: {
          allowedEngines: ['lo'],
          defaultEngine: 'lo',
        },
      })

      assert.equal(parsed.ok, true)

      if (!parsed.ok) {
        throw new Error('expected sandbox policy to parse')
      }

      const validated = validateSandboxExecutionRequest(parsed.value, {
        network: {
          mode: 'on',
        },
        packages: [
          {
            name: 'csv-parse',
            version: '5.6.0',
          },
        ],
        source: {
          kind: 'inline_script',
          script: 'console.log("hi")',
        },
        task: 'Install package',
      })

      assert.equal(validated.ok, false)

      if (validated.ok) {
        throw new Error('expected sandbox request to be rejected')
      }

      assert.equal(validated.error.type, 'conflict')
      assert.match(validated.error.message, /not supported by the lo sandbox engine yet/i)
    },
  )

  runtimePolicyCase(
    'rejects lo-only policies when the configured sandbox provider cannot run lo',
    () => {
      const parsed = parseSandboxPolicyJson({
        enabled: true,
        runtime: {
          allowedEngines: ['lo'],
          defaultEngine: 'lo',
        },
      })

      assert.equal(parsed.ok, true)

      if (!parsed.ok) {
        throw new Error('expected sandbox policy to parse')
      }

      const validated = validateSandboxExecutionRequest(
        parsed.value,
        {
          source: {
            kind: 'inline_script',
            script: 'console.log("hi")',
          },
          task: 'Run inline script',
        },
        {
          supportedRuntimes: ['node'],
        },
      )

      assert.equal(validated.ok, false)

      if (validated.ok) {
        throw new Error('expected sandbox request to be rejected')
      }

      assert.equal(validated.error.type, 'conflict')
      assert.match(validated.error.message, /not supported by the configured sandbox provider/i)
    },
  )

  runtimePolicyCase('rejects packages outside the allow list', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      packages: {
        allowedPackages: [
          {
            name: 'left-pad',
            versionRange: '1.3.0',
          },
        ],
        allowedRegistries: ['registry.npmjs.org'],
        mode: 'allow_list',
      },
      vault: {
        mode: 'read_only',
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    const validated = validateSandboxExecutionRequest(parsed.value, {
      packages: [
        {
          name: 'chalk',
          version: '5.4.1',
        },
      ],
      runtime: 'node',
      source: {
        kind: 'inline_script',
        script: 'console.log("nope")',
      },
      task: 'Install a package',
    })

    assert.equal(validated.ok, false)

    if (validated.ok) {
      throw new Error('expected sandbox request to be rejected')
    }

    assert.equal(validated.error.type, 'permission')
    assert.match(validated.error.message, /not allowlisted/)
  })

  sourcePolicyCase('normalizes write-backs and applies approval flags from policy', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      runtime: {
        allowWorkspaceScripts: true,
      },
      vault: {
        allowedRoots: ['/vault/projects'],
        mode: 'read_write',
        requireApprovalForDelete: true,
        requireApprovalForMove: true,
        requireApprovalForWrite: false,
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    const validated = validateSandboxExecutionRequest(parsed.value, {
      outputs: {
        writeBack: [
          {
            fromPath: '/output/report.txt',
            mode: 'write',
            toVaultPath: 'vault/projects/demo/report.txt',
          },
          {
            fromPath: '/output/archive.zip',
            mode: 'move',
            toVaultPath: '/vault/projects/demo/archive.zip',
          },
          {
            mode: 'delete',
            toVaultPath: '/vault/projects/demo/obsolete.txt',
          },
        ],
      },
      runtime: 'node',
      source: {
        kind: 'inline_script',
        script: 'console.log("write-back")',
      },
      task: 'Write files back',
      vaultAccess: 'read_write',
    })

    assert.equal(validated.ok, true)

    if (!validated.ok) {
      throw new Error('expected sandbox request to validate')
    }

    assert.equal(validated.value.vaultAccessMode, 'read_write')
    assert.deepEqual(validated.value.request.outputs?.writeBack, [
      {
        fromPath: '/output/report.txt',
        mode: 'write',
        toVaultPath: '/vault/projects/demo/report.txt',
      },
      {
        fromPath: '/output/archive.zip',
        mode: 'move',
        toVaultPath: '/vault/projects/demo/archive.zip',
      },
      {
        mode: 'delete',
        toVaultPath: '/vault/projects/demo/obsolete.txt',
      },
    ])
    assert.deepEqual(validated.value.writebacks, [
      {
        fromPath: '/output/report.txt',
        mode: 'write',
        requiresApproval: false,
        toVaultPath: '/vault/projects/demo/report.txt',
      },
      {
        fromPath: '/output/archive.zip',
        mode: 'move',
        requiresApproval: true,
        toVaultPath: '/vault/projects/demo/archive.zip',
      },
      {
        mode: 'delete',
        requiresApproval: true,
        toVaultPath: '/vault/projects/demo/obsolete.txt',
      },
    ])
  })

  sourcePolicyCase('rejects delete write-backs that attempt vault path traversal', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      vault: {
        allowedRoots: ['/vault/projects'],
        mode: 'read_write',
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    const validated = validateSandboxExecutionRequest(parsed.value, {
      outputs: {
        writeBack: [
          {
            mode: 'delete',
            toVaultPath: '/vault/projects/demo/../secrets.txt',
          },
        ],
      },
      runtime: 'node',
      source: {
        kind: 'inline_script',
        script: 'console.log("delete")',
      },
      task: 'Reject unsafe delete',
      vaultAccess: 'read_write',
    })

    assert.equal(validated.ok, false)

    if (validated.ok) {
      throw new Error('expected sandbox request to be rejected')
    }

    assert.equal(validated.error.type, 'validation')
    assert.match(
      validated.error.message,
      /outputs\.writeBack\[\]\.toVaultPath cannot contain relative path traversal/i,
    )
  })

  sourcePolicyCase('accepts inline and workspace source aliases', () => {
    const inlineArgs = validateRunSandboxJobArgs({
      runtime: 'node',
      source: {
        kind: 'inline',
        script: 'console.log("alias")',
      },
      task: 'Inline alias',
    })
    const workspaceArgs = validateRunSandboxJobArgs({
      runtime: 'node',
      source: {
        kind: 'workspace',
        vaultPath: '/vault/project/scripts/task.mjs',
      },
      task: 'Workspace alias',
    })

    assert.equal(inlineArgs.ok, true)
    assert.equal(workspaceArgs.ok, true)
  })

  sourcePolicyCase('accepts top-level inline script alias and normalizes it into source', () => {
    const parsed = validateRunSandboxJobArgs({
      mode: 'bash',
      runtime: 'node',
      script: 'grep -r "nora" . || true',
      task: 'Search for Nora',
    })

    assert.equal(parsed.ok, true)
    if (!parsed.ok) {
      throw new Error('expected top-level script alias to validate')
    }

    assert.deepEqual(parsed.value.source, {
      kind: 'inline',
      script: 'grep -r "nora" . || true',
    })
  })

  sourcePolicyCase('accepts bare string source input and normalizes it into inline source', () => {
    const parsed = validateRunSandboxJobArgs({
      mode: 'bash',
      runtime: 'node',
      source: 'grep -r "nora" . || true',
      task: 'Search for Nora',
    })

    assert.equal(parsed.ok, true)
    if (!parsed.ok) {
      throw new Error('expected bare string source to validate')
    }

    assert.deepEqual(parsed.value.source, {
      kind: 'inline',
      script: 'grep -r "nora" . || true',
    })
  })

  sourcePolicyCase(
    'infers source kind from source.script and source.vaultPath when kind is omitted',
    () => {
      const inlineArgs = validateRunSandboxJobArgs({
        runtime: 'node',
        source: {
          script: 'console.log("alias")',
        },
        task: 'Inline alias',
      })
      const workspaceArgs = validateRunSandboxJobArgs({
        runtime: 'node',
        source: {
          vaultPath: '/vault/project/scripts/task.mjs',
        },
        task: 'Workspace alias',
      })

      assert.equal(inlineArgs.ok, true)
      assert.equal(workspaceArgs.ok, true)

      if (!inlineArgs.ok || !workspaceArgs.ok) {
        throw new Error('expected inferred source kinds to validate')
      }

      assert.deepEqual(inlineArgs.value.source, {
        kind: 'inline',
        script: 'console.log("alias")',
      })
      assert.deepEqual(workspaceArgs.value.source, {
        kind: 'workspace',
        vaultPath: '/vault/project/scripts/task.mjs',
      })
    },
  )

  runtimePolicyCase('defaults runtime to node when omitted', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      vault: {
        mode: 'read_only',
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    const validated = validateSandboxExecutionRequest(parsed.value, {
      source: {
        kind: 'inline_script',
        script: 'console.log("default runtime")',
      },
      task: 'Default runtime',
    })

    assert.equal(validated.ok, true)

    if (!validated.ok) {
      throw new Error('expected sandbox request to validate')
    }

    assert.equal(validated.value.request.runtime, 'node')
  })

  runtimePolicyCase(
    'auto-enables open network for package installs when agent policy allows it',
    () => {
      const parsed = parseSandboxPolicyJson({
        enabled: true,
        network: {
          mode: 'open',
        },
        packages: {
          mode: 'open',
        },
        vault: {
          mode: 'read_only',
        },
      })

      assert.equal(parsed.ok, true)

      if (!parsed.ok) {
        throw new Error('expected sandbox policy to parse')
      }

      const validated = validateSandboxExecutionRequest(parsed.value, {
        network: {
          mode: 'off',
        },
        packages: [
          {
            name: 'pdf-lib',
            version: '1.17.1',
          },
        ],
        runtime: 'node',
        source: {
          kind: 'inline_script',
          script: 'console.log("package install")',
        },
        task: 'Install a package with open network policy',
      })

      assert.equal(validated.ok, true)

      if (!validated.ok) {
        throw new Error('expected sandbox request to validate')
      }

      assert.equal(validated.value.networkMode, 'open')
      assert.equal(validated.value.request.network.mode, 'open')
    },
  )

  runtimePolicyCase(
    'auto-enables allow-list network for package installs and inherits allowed hosts',
    () => {
      const parsed = parseSandboxPolicyJson({
        enabled: true,
        network: {
          allowedHosts: ['registry.npmjs.org'],
          mode: 'allow_list',
        },
        packages: {
          allowedRegistries: ['registry.npmjs.org'],
          mode: 'open',
        },
        vault: {
          mode: 'read_only',
        },
      })

      assert.equal(parsed.ok, true)

      if (!parsed.ok) {
        throw new Error('expected sandbox policy to parse')
      }

      const validated = validateSandboxExecutionRequest(parsed.value, {
        packages: [
          {
            name: 'pdf-lib',
            version: '1.17.1',
          },
        ],
        runtime: 'node',
        source: {
          kind: 'inline_script',
          script: 'console.log("package install")',
        },
        task: 'Install a package with allow-list network policy',
      })

      assert.equal(validated.ok, true)

      if (!validated.ok) {
        throw new Error('expected sandbox request to validate')
      }

      assert.equal(validated.value.networkMode, 'allow_list')
      assert.equal(validated.value.request.network.mode, 'allow_list')
      assert.deepEqual(validated.value.request.network.allowedHosts, ['registry.npmjs.org'])
    },
  )

  runtimePolicyCase('rejects package installs when sandbox network policy is off', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      network: {
        mode: 'off',
      },
      packages: {
        mode: 'open',
      },
      vault: {
        mode: 'read_only',
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    const validated = validateSandboxExecutionRequest(parsed.value, {
      packages: [
        {
          name: 'pdf-lib',
          version: '1.17.1',
        },
      ],
      runtime: 'node',
      source: {
        kind: 'inline_script',
        script: 'console.log("package install")',
      },
      task: 'Install a package with network disabled',
    })

    assert.equal(validated.ok, false)

    if (validated.ok) {
      throw new Error('expected sandbox request to be rejected')
    }

    assert.equal(validated.error.type, 'permission')
    assert.match(validated.error.message, /package installation requires sandbox network access/i)
  })

  runtimePolicyCase('rejects requesting just-bash as an installed package', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      network: {
        mode: 'open',
      },
      packages: {
        mode: 'open',
      },
      vault: {
        mode: 'read_only',
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    const validated = validateSandboxExecutionRequest(parsed.value, {
      packages: [
        {
          name: 'just-bash',
          version: '2.14.0',
        },
      ],
      runtime: 'node',
      source: {
        kind: 'inline_script',
        script: 'console.log("package install")',
      },
      task: 'Attempt to install just-bash',
    })

    assert.equal(validated.ok, false)

    if (validated.ok) {
      throw new Error('expected sandbox request to be rejected')
    }

    assert.equal(validated.error.type, 'validation')
    assert.match(validated.error.message, /already available by default/i)
  })

  sourcePolicyCase('rejects reserved sandbox environment variables', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      vault: {
        mode: 'read_only',
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    const validated = validateSandboxExecutionRequest(parsed.value, {
      env: {
        NODE_OPTIONS: '--allow-fs-read=/',
      },
      runtime: 'node',
      source: {
        kind: 'inline_script',
        script: 'console.log("env")',
      },
      task: 'Reject reserved env keys',
    })

    assert.equal(validated.ok, false)

    if (validated.ok) {
      throw new Error('expected sandbox request to be rejected')
    }

    assert.equal(validated.error.type, 'validation')
    assert.match(validated.error.message, /reserved sandbox environment variable/i)
  })

  sourcePolicyCase('rejects inline script filenames that escape the work directory', () => {
    const parsed = parseSandboxPolicyJson({
      enabled: true,
      vault: {
        mode: 'read_only',
      },
    })

    assert.equal(parsed.ok, true)

    if (!parsed.ok) {
      throw new Error('expected sandbox policy to parse')
    }

    const validated = validateSandboxExecutionRequest(parsed.value, {
      runtime: 'node',
      source: {
        filename: '../../escape.mjs',
        kind: 'inline_script',
        script: 'console.log("filename")',
      },
      task: 'Reject unsafe inline filename',
    })

    assert.equal(validated.ok, false)

    if (validated.ok) {
      throw new Error('expected sandbox request to be rejected')
    }

    assert.equal(validated.error.type, 'validation')
    assert.match(validated.error.message, /relative path traversal/i)
  })
  test('sandbox runtime and network policy matrix', () => {
    runPolicyMatrix(runtimePolicyCases)
  })

  test('sandbox source, path, and writeback policy matrix', () => {
    runPolicyMatrix(sourcePolicyCases)
  })
})
