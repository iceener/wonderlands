# sandbox-runtime-lo

This workspace package is the future home of the `lo`-based sandbox runtime.

It is intentionally scaffold-only for now. The current server still executes
through the Node compat engine in `local_dev`.

Build the bootstrap artifact with:

```sh
npm run build --workspace @wonderlands/sandbox-runtime-lo
```

Current `local_dev` discovery expects:

- `SANDBOX_LO_BINARY` to point at a runnable `lo` binary, or `lo` to be available on `PATH`
- `SANDBOX_LO_BOOTSTRAP_ENTRY` to point at the built bootstrap entry, or a future default build output under `packages/sandbox-runtime-lo/dist/`

Until both assets exist, the server keeps `lo` unavailable and falls back to the
Node compat engine.

Planned responsibilities:

- bootstrap JS execution for the safe `lo` engine
- provide sandbox path mapping for `/input`, `/work`, `/output`, and `/vault`
- host the bundled `just-bash` entrypoint for bash-style sandbox execution
- expose a tiny host API surface instead of raw runtime internals

Current limitations:

- the built bootstrap only wires script-mode manifest loading so far
- package-backed jobs still require the Node compat engine
- `just-bash` on `lo` is not implemented yet
