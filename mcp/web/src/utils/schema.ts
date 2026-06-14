import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema as zodToJson } from 'zod-to-json-schema';

/**
 * Convert a Zod schema to JSON Schema for MCP.
 *
 * This strips metadata that MCP doesn't need and ensures
 * compatibility with the protocol's JSON Schema expectations.
 */
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const jsonSchema = zodToJson(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  });

  // Remove $schema as MCP doesn't need it
  const { $schema: _, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}
