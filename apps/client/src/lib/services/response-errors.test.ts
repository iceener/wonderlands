import { describe, expect, test } from 'vitest'
import { humanizeErrorMessage, readErrorResponseMessage } from './response-errors'

describe('response errors', () => {
  test.each([
    {
      expected: 'The server is not available right now. Refresh the page and try again.',
      message: 'Failed to read browser auth session (502)',
      options: { status: 502 },
    },
    {
      expected:
        'The selected model provider is not configured on the backend. Check the backend API keys and model settings.',
      message: 'Google GenAI provider is not configured',
      options: undefined,
    },
    {
      expected: 'Your browser session is out of sync. Refresh the page and try again.',
      message: 'Request must not mix API key auth with another authentication method',
      options: undefined,
    },
    {
      expected:
        'An MCP with that name already exists in your workspace. Use a different name or let the UI rename it for you.',
      message:
        'failed to create MCP server mcs_1: UNIQUE constraint failed: mcp_servers.tenant_id, mcp_servers.created_by_account_id, mcp_servers.label',
      options: undefined,
    },
    {
      expected:
        "The MCP server rejected your Authorization header. Verify you entered the server's own bearer token exactly as configured on that server.",
      message:
        'Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32001,"message":"Invalid authorization token"},"id":null}',
      options: undefined,
    },
  ])('humanizes $message', ({ expected, message, options }) => {
    expect(humanizeErrorMessage(message, options)).toBe(expected)
  })

  test('humanizes structured backend provider errors', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: 'Google GenAI provider is not configured',
          type: 'provider',
        },
        ok: false,
      }),
      {
        headers: { 'content-type': 'application/json' },
        status: 400,
      },
    )

    await expect(readErrorResponseMessage(response, 'Request failed')).resolves.toBe(
      'The selected model provider is not configured on the backend. Check the backend API keys and model settings.',
    )
  })
})
