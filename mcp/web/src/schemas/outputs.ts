import { z } from 'zod';

/**
 * Output schemas for tools with structured output.
 * These can be used as `outputSchema` in tool registration.
 */

/** Standard success response */
export const successOutput = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

/** Echo tool output */
export const echoOutput = z.object({
  echoed: z.string().describe('The echoed message'),
  timestamp: z.string().describe('ISO timestamp when the echo was processed'),
  length: z.number().describe('Length of the message in characters'),
});

/** HTTP fetch output */
export const fetchOutput = z.object({
  status: z.number().describe('HTTP status code'),
  statusText: z.string().describe('HTTP status text'),
  headers: z.record(z.string()).describe('Response headers'),
  body: z.string().describe('Response body as string'),
  duration: z.number().describe('Request duration in milliseconds'),
});

/** File info output */
export const fileInfoOutput = z.object({
  path: z.string(),
  exists: z.boolean(),
  size: z.number().optional(),
  isDirectory: z.boolean().optional(),
  modifiedAt: z.string().optional(),
});
