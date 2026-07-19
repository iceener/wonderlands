// Barrel module: keeps the public MCP code-mode API stable while the
// implementation is split across cohesive files:
//   - mcp-code-mode-catalog.ts: catalog building, search, inventory message
//   - mcp-code-mode-tool-resolution.ts: name resolution and loaded-tool filtering
//   - mcp-code-mode-static-checks.ts: static script analysis and confirmation copy
//   - mcp-code-mode-codegen.ts: TypeScript declaration + wrapper script rendering

export type {
  McpCodeModeCatalog,
  McpCodeModeServerBinding,
  McpCodeModeToolBinding,
} from './mcp-code-mode-catalog'
export {
  buildMcpCodeModeCatalog,
  formatMcpCodeModeInventoryMessage,
  searchMcpCodeModeCatalog,
} from './mcp-code-mode-catalog'
export {
  renderMcpCodeModeTypeScript,
  renderMcpCodeModeTypeScriptBundle,
  renderMcpCodeModeWrapperScript,
} from './mcp-code-mode-codegen'
export {
  findMcpCodeModeModuleSyntaxMisuse,
  findMcpRuntimeNameCallMisuse,
  findReferencedMcpCodeModeBindings,
  findReferencedNonExecutableMcpCodeModeTools,
  formatMcpCodeModeConfirmationDescription,
  isMcpCodeModeConfirmationTargetRef,
  MCP_CODE_MODE_CONFIRMATION_TARGET_REF,
} from './mcp-code-mode-static-checks'
export type {
  McpCodeModeAmbiguousToolMatch,
  McpCodeModeResolvedToolMatch,
} from './mcp-code-mode-tool-resolution'
export {
  collectLoadedMcpCodeModeLookups,
  filterMcpCodeModeCatalogToLoadedTools,
  resolveMcpCodeModeTools,
} from './mcp-code-mode-tool-resolution'
