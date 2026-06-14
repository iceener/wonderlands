import type { InteractionCapabilities } from './attachment-ref-access'

export const formatCapabilityGuidanceDeveloperMessage = (
  capabilities: InteractionCapabilities,
): string => {
  if (!capabilities.browserJobs) {
    return ''
  }

  const lines = [
    'Capability guidance:',
    '',
    '- `browse` is available for live website interaction: navigation, clicks, form filling, DOM inspection, screenshots, PDFs, cookies, and browser-state capture.',
    '- Keep browser scripts short and focused. Return JSON-serializable results from the script instead of logging or printing large blobs.',
    '- Use browser jobs when the task requires a real page, live rendering, client-side JavaScript, or authenticated browser state.',
  ]

  if (capabilities.sandboxExecute) {
    lines.push(
      '- Sandbox tools are also available in this run. Use them for local file transforms, `/vault` work, package-backed processing, and non-browser parsing.',
    )

    lines.push(
      '- Prefer `execute` as the default sandbox tool. It defaults to `mode: "bash"` for quick `find`/`rg`/`ls`/`cat` style inspection over mounted files. Use `mode: "script"` when you need custom JavaScript, MCP code-mode scripts, packages, or structured parsing.',
    )
    lines.push(
      '- In `execute` script mode, inline JavaScript normally runs as an ES module. Prefer `await import(...)`, avoid `require(...)`, and outside MCP code mode do not use top-level `return`. When MCP code mode is active, write a script body, not a full module: the runtime wraps your code in an async function, so `return` is allowed there but static top-level `import`/`export` is not.',
    )
  } else {
    lines.push(
      '- Browser jobs do not replace workspace or shell tools. Use them only when a live browser is actually needed.',
    )
  }

  lines.push(
    '- Request screenshots, PDFs, HTML, cookies, or recordings only when they materially help the conversation. Those outputs become normal run attachments.',
  )

  return lines.join('\n')
}
