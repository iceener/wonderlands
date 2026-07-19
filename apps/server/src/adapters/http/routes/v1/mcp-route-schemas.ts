import { z } from 'zod'
import { toZodErrorMessage } from '../../validation'

const logLevelSchema = z.enum([
  'alert',
  'critical',
  'debug',
  'emergency',
  'error',
  'info',
  'notice',
  'warning',
])

const recordSchema = z.record(z.string(), z.string())

const mcpStoredHttpAuthSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('none'),
  }),
  z.object({
    kind: z.literal('bearer'),
    token: z.string().trim().min(1),
  }),
  z.object({
    clientId: z.string().trim().min(1).optional(),
    clientName: z.string().trim().min(1).optional(),
    clientSecret: z.string().trim().min(1).optional(),
    kind: z.literal('oauth_authorization_code'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
    tokenEndpointAuthMethod: z.string().trim().min(1).optional(),
  }),
  z.object({
    clientId: z.string().trim().min(1),
    clientSecret: z.string().trim().min(1),
    kind: z.literal('oauth_client_credentials'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
  z.object({
    algorithm: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    kind: z.literal('oauth_private_key_jwt'),
    privateKey: z.string().trim().min(1),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
  z.object({
    assertion: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    kind: z.literal('oauth_static_private_key_jwt'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
])

export const createMcpServerInputSchema = z.discriminatedUnion('kind', [
  z.object({
    config: z.object({
      args: z.array(z.string()).optional(),
      command: z.string().trim().min(1),
      cwd: z.string().trim().min(1).optional(),
      env: recordSchema.optional(),
      stderr: z.enum(['inherit', 'pipe']).optional(),
    }),
    enabled: z.boolean().optional(),
    kind: z.literal('stdio'),
    label: z.string().trim().min(1).max(200),
    logLevel: logLevelSchema.optional(),
  }),
  z.object({
    config: z.object({
      auth: mcpStoredHttpAuthSchema.optional(),
      headers: recordSchema.optional(),
      url: z.string().url(),
    }),
    enabled: z.boolean().optional(),
    kind: z.literal('streamable_http'),
    label: z.string().trim().min(1).max(200),
    logLevel: logLevelSchema.optional(),
  }),
])

export const assignMcpToolInputSchema = z
  .object({
    toolProfileId: z.string().trim().min(1).max(200).optional(),
    requiresConfirmation: z.boolean().optional(),
    runtimeName: z.string().trim().min(1).max(300),
    serverId: z.string().trim().min(1).max(200),
  })
  .refine((value) => Boolean(value.toolProfileId), {
    message: 'toolProfileId is required',
    path: ['toolProfileId'],
  })

export const deleteMcpToolAssignmentQuerySchema = z
  .object({
    toolProfileId: z.string().trim().min(1).max(200).optional(),
  })
  .refine((value) => Boolean(value.toolProfileId), {
    message: 'toolProfileId is required',
    path: ['toolProfileId'],
  })

export const beginMcpAuthorizationInputSchema = z.object({
  responseOrigin: z.string().url().optional(),
})

export const mcpAppOriginQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).optional(),
    format: z.enum(['html', 'raw']).optional(),
    serverId: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
    uri: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.serverId || value.toolName), {
    message: 'Missing required query parameters: serverId (or toolName)',
    path: ['serverId'],
  })

export const mcpAppToolCallInputSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()).nullish(),
    name: z.string().trim().min(1),
    serverId: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.serverId || value.toolName), {
    message: 'Missing required body fields: serverId (or toolName)',
    path: ['serverId'],
  })

export const mcpOauthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  error_description: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1),
})

export const toValidationMessage = toZodErrorMessage
