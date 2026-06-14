import type { BrowserAuthSession } from './services/auth'

interface AppShellAuthInput {
  authCheckPending: boolean
  authSession: BrowserAuthSession | null
  selectedTenantId: string | null
  showConnectingScreen: boolean
}

export const isReturningWorkspaceUser = (selectedTenantId: string | null): boolean =>
  selectedTenantId !== null

export const shouldShowConnectingWorkspaceScreen = ({
  authCheckPending,
  selectedTenantId,
  showConnectingScreen,
}: AppShellAuthInput): boolean =>
  authCheckPending && showConnectingScreen && !isReturningWorkspaceUser(selectedTenantId)

export const shouldShowBlankAuthScreen = (input: AppShellAuthInput): boolean =>
  input.authCheckPending &&
  !shouldShowConnectingWorkspaceScreen(input) &&
  !shouldRenderMainShell(input)

export const shouldShowLoginScreen = ({
  authCheckPending,
  authSession,
}: AppShellAuthInput): boolean => !authCheckPending && authSession === null

export const shouldShowNoWorkspaceScreen = ({
  authCheckPending,
  authSession,
}: AppShellAuthInput): boolean =>
  !authCheckPending && authSession !== null && authSession.memberships.length === 0

export const shouldRenderMainShell = ({
  authCheckPending,
  authSession,
  selectedTenantId,
}: AppShellAuthInput): boolean =>
  (authSession !== null && authSession.memberships.length > 0) ||
  (authCheckPending && isReturningWorkspaceUser(selectedTenantId))
