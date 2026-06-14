import type {
  BackendAccountPreferences,
  UpdateAccountPreferencesInput,
} from '@wonderlands/contracts/chat'
import { apiRequest } from '../backend'

export const getAccountPreferences = (): Promise<BackendAccountPreferences> =>
  apiRequest<BackendAccountPreferences>('/account/preferences')

export const updateAccountPreferences = (
  input: UpdateAccountPreferencesInput,
): Promise<BackendAccountPreferences> =>
  apiRequest<BackendAccountPreferences>('/account/preferences', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export const resetShortcutBindings = (
  input: { actionIds?: string[] } = {},
): Promise<BackendAccountPreferences> =>
  apiRequest<BackendAccountPreferences>('/account/preferences/shortcuts/reset', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
