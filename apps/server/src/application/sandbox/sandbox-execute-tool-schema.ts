// JSON input schema for the `execute` native tool. Extracted verbatim from
// register-sandbox-native-tools.ts to keep tool registration logic separate
// from the (large) declarative schema data.
export const sandboxExecuteToolInputSchema = {
  additionalProperties: false,
  properties: {
    args: {
      description: 'Optional argv passed to the sandbox script.',
      items: {
        type: 'string',
      },
      type: 'array',
    },
    attachments: {
      description: 'Optional files to stage into the sandbox, usually mounted under /input/....',
      items: {
        additionalProperties: false,
        properties: {
          fileId: {
            description:
              'Existing file id or full canonical attachment ref to stage into the sandbox. Do not pass shorthand aliases like attachment[1] or image[2] here.',
            type: 'string',
          },
          mountPath: {
            description:
              'Optional absolute sandbox path where the attachment should appear. Prefer /input/... for files used only during the run.',
            type: 'string',
          },
        },
        required: ['fileId'],
        type: 'object',
      },
      type: 'array',
    },
    garden: {
      description:
        'Optional Garden slug or gst_... id. Prefer this for Garden work; the server will mount that garden at its resolved /vault source root, set `pwd` to that root automatically, and resolve relative outputs.writeBack.toVaultPath values under that garden root. After `garden: "overment"`, prefer relative paths like `_garden.yml` over guessed absolute paths. Use `toVaultPath: "."` to target the garden root itself.',
      type: 'string',
    },
    mode: {
      description:
        'Execution mode. execute defaults to bash when omitted. Use bash for shell-style file inspection or manipulation, and script for custom JavaScript or MCP code-mode scripts.',
      enum: ['script', 'bash'],
      type: 'string',
    },
    cwdVaultPath: {
      description:
        'Optional /vault/... path to stage and use as the working directory. This is one way to make /vault content available inside the sandbox. Usually omit this when garden is provided.',
      type: 'string',
    },
    env: {
      description: 'Optional environment variables for the sandbox process.',
      additionalProperties: {
        type: 'string',
      },
      type: 'object',
    },
    filename: {
      description:
        'Optional filename for inline script input. Inline script defaults to an ES module file, so usually omit this or use a stable `.mjs` name. Use a `.cjs` filename only when the script truly needs CommonJS `require(...)` semantics.',
      type: 'string',
    },
    network: {
      description:
        'Optional runtime network request. If omitted, network defaults to off. Use on only when the agent policy allows it; allow-listed agents may still be restricted to approved hosts.',
      additionalProperties: false,
      properties: {
        hosts: {
          description:
            'Optional host allow list for this run when network.mode is on and the agent policy uses an allow list.',
          items: {
            type: 'string',
          },
          type: 'array',
        },
        mode: {
          description: 'Use off for no network or on for network access allowed by policy.',
          enum: ['off', 'on'],
          type: 'string',
        },
      },
      required: ['mode'],
      type: 'object',
    },
    outputs: {
      description:
        'Optional output handling. Matching files can be attached after the run, and writeBack entries can request later vault changes.',
      additionalProperties: false,
      properties: {
        attachGlobs: {
          description:
            'Promote matching sandbox files, usually under /output/..., as attachments after the run completes.',
          items: {
            type: 'string',
          },
          type: 'array',
        },
        writeBack: {
          description:
            'Propose copy, move, write, or delete operations into /vault/.... This requires read_write vault access and still needs commit_sandbox_writeback after the run completes. For write, copy, and move, provide both fromPath and toVaultPath. For delete, provide only toVaultPath. Delete still validates the target as a canonical /vault path, rejects traversal, and asks for execute-time confirmation before the sandbox launches.',
          items: {
            oneOf: [
              {
                additionalProperties: false,
                properties: {
                  fromPath: {
                    description:
                      'Absolute sandbox path to copy from, usually /output/... or another absolute path created during the run.',
                    type: 'string',
                  },
                  mode: {
                    description: 'How the sandbox file should later be applied into /vault.',
                    enum: ['write', 'copy', 'move'],
                    type: 'string',
                  },
                  toVaultPath: {
                    description:
                      'Target path under /vault/.... When garden is provided, a relative path resolves under that garden root.',
                    type: 'string',
                  },
                },
                required: ['fromPath', 'mode', 'toVaultPath'],
                type: 'object',
              },
              {
                additionalProperties: false,
                properties: {
                  mode: {
                    description: 'Delete an existing path in /vault at commit time.',
                    enum: ['delete'],
                    type: 'string',
                  },
                  toVaultPath: {
                    description:
                      'Target path under /vault/.... When garden is provided, a relative path resolves under that garden root.',
                    type: 'string',
                  },
                },
                required: ['mode', 'toVaultPath'],
                type: 'object',
              },
            ],
          },
          type: 'array',
        },
      },
      type: 'object',
    },
    packages: {
      description:
        'Exact npm packages to install before the script runs, for example { name: "pdf-lib", version: "1.17.1" }. Do not list built-in packages like just-bash here.',
      items: {
        additionalProperties: false,
        properties: {
          name: { description: 'npm package name.', type: 'string' },
          version: { description: 'Exact package version.', type: 'string' },
        },
        required: ['name', 'version'],
        type: 'object',
      },
      type: 'array',
    },
    script: {
      description:
        'Preferred inline input for execute. In bash mode this is the shell-style script body. In script mode this is JavaScript source code. Inline script mode normally runs as an ES module: prefer `await import(...)`, avoid `require(...)` unless you intentionally use a `.cjs` filename, and outside MCP code mode do not use top-level `return`. In MCP code mode, write a script body, not a full module: the runtime wraps your code in an awaited async function, so `return` is allowed there but static top-level `import`/`export` is not. Use `await import(...)` inside the script body instead. Provider note: the current local_dev Node runner installs requested npm packages with `--ignore-scripts`, so packages that need native addons or install-time setup, such as `sharp`, may fail; prefer pure-JS packages when possible. When script is provided, omit source.',
      type: 'string',
    },
    source: {
      description:
        'Advanced source object. Always pass source as an object, never as a bare string. Prefer the top-level script field for inline bash or JavaScript. Use source only when you need an explicit kind or a staged workspace script.',
      additionalProperties: false,
      properties: {
        filename: {
          description:
            'Optional filename to use for inline script input inside /work. Inline script defaults to ES module semantics; use `.cjs` only when CommonJS is required.',
          type: 'string',
        },
        kind: {
          description:
            'Use inline or inline_script for inline content, or workspace or workspace_script for a staged /vault script. When omitted, the server infers inline from script or workspace from vaultPath.',
          enum: ['inline', 'inline_script', 'workspace', 'workspace_script'],
          type: 'string',
        },
        script: {
          description:
            'Inline content. In bash mode this is the shell script string. In script mode this is JavaScript source code.',
          type: 'string',
        },
        vaultPath: {
          description:
            'Path to an existing staged script under /vault/.... When garden is provided, a relative path resolves under that garden root.',
          type: 'string',
        },
      },
      type: 'object',
    },
    task: {
      description: 'Short human-readable task title for the sandbox run.',
      type: 'string',
    },
    vaultAccess: {
      description:
        'Optional vault access override kept for compatibility. Usually omit it; the server infers read_only or read_write from mounted inputs and outputs.writeBack. This grants permission only; it does not mount /vault into the sandbox by itself.',
      enum: ['read_only', 'read_write'],
      type: 'string',
    },
    vaultInputs: {
      description:
        'Optional files or directories to stage from /vault into the sandbox. Use this or cwdVaultPath whenever your script needs to read /vault/... paths. Usually omit this when garden is provided.',
      items: {
        additionalProperties: false,
        properties: {
          mountPath: {
            description:
              'Optional absolute sandbox path where the staged vault entry should appear. /vault/... is the safest default, but any absolute sandbox path is accepted.',
            type: 'string',
          },
          vaultPath: { description: 'Source path under /vault/....', type: 'string' },
        },
        required: ['vaultPath'],
        type: 'object',
      },
      type: 'array',
    },
    vaultPath: {
      description:
        'Preferred alias for a staged workspace script under /vault/.... Use this instead of source for simple workspace script runs. When garden is provided, a relative path resolves under that garden root.',
      type: 'string',
    },
  },
  required: ['task'],
  type: 'object',
}
