import { describe, expect, test } from 'vitest'
import { humanizeErrorMessage, readErrorResponseMessage } from './response-errors'

describe('humanizeErrorMessage', () => {
  test('maps auth session bootstrap transport failures to a backend-availability message', () => {
    expect(
      humanizeErrorMessage('Failed to read browser auth session (502)', {
        status: 502,
      }),
    ).toBe('The server is not available right now. Refresh the page and try again.')
  })

  test('maps provider configuration failures to a user-friendly setup message', () => {
    expect(humanizeErrorMessage('Google GenAI provider is not configured')).toBe(
      'The selected model provider is not configured on the backend. Check the backend API keys and model settings.',
    )
  })

  test('maps mixed auth failures to a refresh hint', () => {
    expect(
      humanizeErrorMessage('Request must not mix API key auth with another authentication method'),
    ).toBe('Your browser session is out of sync. Refresh the page and try again.')
  })

  test('maps duplicate MCP labels to a readable workspace message', () => {
    expect(
      humanizeErrorMessage(
        'failed to create MCP server mcs_1: UNIQUE constraint failed: mcp_servers.tenant_id, mcp_servers.created_by_account_id, mcp_servers.label',
      ),
    ).toBe(
      'An MCP with that name already exists in your workspace. Use a different name or let the UI rename it for you.',
    )
  })

  test('maps MCP authorization token failures to a concrete fix hint', () => {
    expect(
      humanizeErrorMessage(
        'Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32001,"message":"Invalid authorization token"},"id":null}',
      ),
    ).toBe(
      "The MCP server rejected your Authorization header. Verify you entered the server's own bearer token exactly as configured on that server.",
    )
  })
})

describe('readErrorResponseMessage', () => {
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
