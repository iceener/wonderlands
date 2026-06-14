import { describe, expect, test } from 'vitest'
import {
  shouldRenderMainShell,
  shouldShowBlankAuthScreen,
  shouldShowConnectingWorkspaceScreen,
  shouldShowLoginScreen,
  shouldShowNoWorkspaceScreen,
} from './app-shell-auth'
import type { BrowserAuthSession } from './services/auth'

const authSessionWithMemberships = (
  memberships: BrowserAuthSession['memberships'],
): BrowserAuthSession => ({
  account: {
    email: 'user@example.com',
    id: 'acc_1',
    name: 'User',
  },
  auth: {
    expiresAt: '2026-04-08T12:00:00.000Z',
    kind: 'auth_session',
    sessionId: 'aus_1',
  },
  memberships,
  tenantScope: memberships[0]
    ? {
        accountId: 'acc_1',
        role: memberships[0].role,
        tenantId: memberships[0].tenantId,
      }
    : null,
})

describe('app shell auth gating', () => {
  test('renders the main shell for returning users while auth is still pending', () => {
    expect(
      shouldRenderMainShell({
        authCheckPending: true,
        authSession: null,
        selectedTenantId: 'ten_1',
        showConnectingScreen: false,
      }),
    ).toBe(true)
    expect(
      shouldShowLoginScreen({
        authCheckPending: true,
        authSession: null,
        selectedTenantId: 'ten_1',
        showConnectingScreen: false,
      }),
    ).toBe(false)
  })

  test('keeps the blank and connecting auth screens only for first-time visitors', () => {
    expect(
      shouldShowBlankAuthScreen({
        authCheckPending: true,
        authSession: null,
        selectedTenantId: null,
        showConnectingScreen: false,
      }),
    ).toBe(true)
    expect(
      shouldShowConnectingWorkspaceScreen({
        authCheckPending: true,
        authSession: null,
        selectedTenantId: null,
        showConnectingScreen: true,
      }),
    ).toBe(true)
  })

  test('falls back to the login screen when auth finishes without a session', () => {
    expect(
      shouldShowLoginScreen({
        authCheckPending: false,
        authSession: null,
        selectedTenantId: 'ten_1',
        showConnectingScreen: false,
      }),
    ).toBe(true)
    expect(
      shouldRenderMainShell({
        authCheckPending: false,
        authSession: null,
        selectedTenantId: 'ten_1',
        showConnectingScreen: false,
      }),
    ).toBe(false)
  })

  test('shows the no-workspace screen after auth resolves for users without memberships', () => {
    expect(
      shouldShowNoWorkspaceScreen({
        authCheckPending: false,
        authSession: authSessionWithMemberships([]),
        selectedTenantId: null,
        showConnectingScreen: false,
      }),
    ).toBe(true)
  })
})
