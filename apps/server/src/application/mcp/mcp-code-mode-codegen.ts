import type { McpCodeModeCatalog, McpCodeModeToolBinding } from './mcp-code-mode-catalog'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const escapeBlockComment = (value: string): string => value.replace(/\*\//g, '*\\/')

const toJsDoc = (description: string | null | undefined, indent = ''): string[] => {
  const text = description?.trim() ?? ''

  if (!text) {
    return []
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return [
    `${indent}/**`,
    ...lines.map((line) => `${indent} * ${escapeBlockComment(line)}`),
    `${indent} */`,
  ]
}

const toPascalCase = (value: string): string => {
  const parts = value.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0)
  const joined = parts.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join('')

  return joined.length > 0 ? joined : 'Generated'
}

const singularize = (value: string): string => {
  if (value.endsWith('ies') && value.length > 3) {
    return `${value.slice(0, -3)}y`
  }

  if (
    ['ches', 'shes', 'sses', 'xes', 'zes'].some((suffix) => value.endsWith(suffix)) &&
    value.length > 4
  ) {
    return value.slice(0, -2)
  }

  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 1) {
    return value.slice(0, -1)
  }

  return `${value}Item`
}

interface TypeRenderContext {
  declarations: string[]
  seenNames: Set<string>
}

const renderLiteralType = (value: unknown): string => {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return 'unknown'
}

const renderSchemaType = (
  schemaValue: unknown,
  nameHint: string,
  context: TypeRenderContext,
): string => {
  if (!isRecord(schemaValue)) {
    return 'unknown'
  }

  if (Array.isArray(schemaValue.enum) && schemaValue.enum.length > 0) {
    return schemaValue.enum.map((entry) => renderLiteralType(entry)).join(' | ')
  }

  if ('const' in schemaValue) {
    return renderLiteralType(schemaValue.const)
  }

  if (Array.isArray(schemaValue.oneOf) && schemaValue.oneOf.length > 0) {
    return schemaValue.oneOf
      .map((entry, index) => renderSchemaType(entry, `${nameHint}${index + 1}`, context))
      .join(' | ')
  }

  if (Array.isArray(schemaValue.anyOf) && schemaValue.anyOf.length > 0) {
    return schemaValue.anyOf
      .map((entry, index) => renderSchemaType(entry, `${nameHint}${index + 1}`, context))
      .join(' | ')
  }

  const typeValue = schemaValue.type

  if (Array.isArray(typeValue) && typeValue.length > 0) {
    return typeValue
      .map((entry, index) =>
        renderSchemaType({ ...schemaValue, type: entry }, `${nameHint}${index + 1}`, context),
      )
      .join(' | ')
  }

  switch (typeValue) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array': {
      const itemType = renderSchemaType(schemaValue.items, singularize(nameHint), context)
      return `Array<${itemType}>`
    }
    case 'object': {
      const interfaceName = toPascalCase(nameHint)

      if (context.seenNames.has(interfaceName)) {
        return interfaceName
      }

      context.seenNames.add(interfaceName)
      const properties = isRecord(schemaValue.properties) ? schemaValue.properties : {}
      const required = Array.isArray(schemaValue.required)
        ? new Set(
            schemaValue.required.filter((entry): entry is string => typeof entry === 'string'),
          )
        : new Set<string>()
      const propertyLines = Object.entries(properties).flatMap(([key, propertySchema]) => {
        const propertyDescription = isRecord(propertySchema)
          ? toJsDoc(
              typeof propertySchema.description === 'string' ? propertySchema.description : null,
              '  ',
            )
          : []
        const propertyType = renderSchemaType(
          propertySchema,
          `${interfaceName}${toPascalCase(key)}`,
          context,
        )

        return [
          ...propertyDescription,
          `  ${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${propertyType};`,
        ]
      })
      const additionalProperties = schemaValue.additionalProperties
      const additionalPropertyLine =
        additionalProperties && typeof additionalProperties === 'object'
          ? `  [key: string]: ${renderSchemaType(
              additionalProperties,
              `${interfaceName}Value`,
              context,
            )};`
          : additionalProperties === true
            ? '  [key: string]: unknown;'
            : null

      context.declarations.push(
        [
          `interface ${interfaceName} {`,
          ...(propertyLines.length > 0 ? propertyLines : []),
          ...(additionalPropertyLine ? [additionalPropertyLine] : []),
          ...(propertyLines.length === 0 && !additionalPropertyLine
            ? ['  [key: string]: unknown;']
            : []),
          `}`,
        ].join('\n'),
      )

      return interfaceName
    }
    default:
      return 'unknown'
  }
}

export const renderMcpCodeModeTypeScript = (tool: McpCodeModeToolBinding): string => {
  return renderMcpCodeModeTypeScriptBundle([tool])
}

export const renderMcpCodeModeTypeScriptBundle = (tools: McpCodeModeToolBinding[]): string => {
  const context: TypeRenderContext = {
    declarations: [],
    seenNames: new Set<string>(),
  }
  const membersByNamespace = new Map<string, string[]>()

  for (const tool of tools) {
    const inputTypeName = `${toPascalCase(tool.namespace)}${toPascalCase(tool.member)}Input`
    const outputTypeName = `${toPascalCase(tool.namespace)}${toPascalCase(tool.member)}Output`
    const inputType = renderSchemaType(tool.inputSchema, inputTypeName, context)
    const outputType = tool.outputSchema
      ? renderSchemaType(tool.outputSchema, outputTypeName, context)
      : 'unknown'
    const currentMembers = membersByNamespace.get(tool.namespace) ?? []

    currentMembers.push(
      ...toJsDoc(tool.description, '  '),
      `  ${tool.member}(input: ${inputType}): Promise<${outputType}>;`,
    )

    membersByNamespace.set(tool.namespace, currentMembers)
  }

  const namespaceDeclarations = [...membersByNamespace.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([namespace, members]) => [`declare const ${namespace}: {`, ...members, `};`])

  return [...context.declarations, '', ...namespaceDeclarations].join('\n').trim()
}

export const renderMcpCodeModeWrapperScript = (input: {
  catalog: McpCodeModeCatalog
  code: string
}): string => {
  const wrappedCode = input.code
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
  const helperLines = [
    'const __wonderlandsCreateBridgeError = (error) => {',
    '  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {',
    '    return new Error(error.message);',
    '  }',
    '  return new Error("Unknown MCP bridge error");',
    '};',
    'const __wonderlandsNormalizeMcpResult = (result) => {',
    '  if (!result || typeof result !== "object") {',
    '    return result ?? null;',
    '  }',
    '  if ("structuredContent" in result) {',
    '    const structured = result.structuredContent;',
    '    if (structured !== undefined && structured !== null) {',
    '      return structured;',
    '    }',
    '  }',
    '  return result ?? null;',
    '};',
    'const __wonderlandsPrintResult = (value) => {',
    '  if (value === undefined) {',
    '    return;',
    '  }',
    '  if (typeof value === "string") {',
    '    console.log(value);',
    '    return;',
    '  }',
    '  try {',
    '    const json = JSON.stringify(value);',
    '    console.log(json === undefined ? String(value) : json);',
    '    return;',
    '  } catch {',
    '    console.log(String(value));',
    '  }',
    '};',
    'const __wonderlandsCallMcp = typeof globalThis.__wonderlandsCallMcp === "function"',
    '  ? async (runtimeName, args) => __wonderlandsNormalizeMcpResult(await globalThis.__wonderlandsCallMcp(runtimeName, args))',
    '  : (() => {',
    '      const pendingCalls = new Map();',
    '      let sequence = 0;',
    '      const setChannelReferenced = (referenced) => {',
    '        if (!process.channel) {',
    '          return;',
    '        }',
    '        if (referenced) {',
    '          process.channel.ref?.();',
    '          return;',
    '        }',
    '        process.channel.unref?.();',
    '      };',
    '      setChannelReferenced(false);',
    '      process.on("message", (message) => {',
    '        if (!message || typeof message !== "object" || message.type !== "wonderlands_mcp_response") {',
    '          return;',
    '        }',
    '        const pending = pendingCalls.get(message.id);',
    '        if (!pending) {',
    '          return;',
    '        }',
    '        pendingCalls.delete(message.id);',
    '        if (pendingCalls.size === 0) {',
    '          setChannelReferenced(false);',
    '        }',
    '        if (message.ok) {',
    '          pending.resolve(__wonderlandsNormalizeMcpResult(message.result));',
    '          return;',
    '        }',
    '        pending.reject(__wonderlandsCreateBridgeError(message.error));',
    '      });',
    '      return (runtimeName, args) => new Promise((resolve, reject) => {',
    '        if (typeof process.send !== "function") {',
    '          reject(new Error("MCP bridge is not available in this sandbox runtime"));',
    '          return;',
    '        }',
    '        const id = `mcp_${++sequence}`;',
    '        pendingCalls.set(id, { reject, resolve });',
    '        setChannelReferenced(true);',
    '        process.send({ args: args ?? {}, id, runtimeName, type: "wonderlands_mcp_call" });',
    '      });',
    '    })();',
  ]

  const bindingLines = input.catalog.servers.flatMap((server) => {
    const executableTools = server.tools.filter((tool) => tool.executable)

    if (executableTools.length === 0) {
      return []
    }

    return [
      `globalThis.${server.namespace} = Object.freeze({`,
      ...executableTools.map(
        (tool) =>
          `  ${tool.member}: async (input) => await __wonderlandsCallMcp(${JSON.stringify(tool.runtimeName)}, input),`,
      ),
      '});',
    ]
  })

  return [
    ...helperLines,
    ...bindingLines,
    '',
    'const __wonderlandsResult = await (async () => {',
    wrappedCode,
    '})();',
    'if (typeof globalThis.__wonderlandsWaitForMcpIdle === "function") {',
    '  await globalThis.__wonderlandsWaitForMcpIdle();',
    '}',
    '__wonderlandsPrintResult(__wonderlandsResult);',
  ].join('\n')
}
