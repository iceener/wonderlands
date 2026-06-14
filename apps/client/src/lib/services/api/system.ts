import type { BackendSystemRuntimeStatus } from '@wonderlands/contracts/chat'
import { apiRequest } from '../backend'

export const getSystemRuntimeStatus = (): Promise<BackendSystemRuntimeStatus> =>
  apiRequest<BackendSystemRuntimeStatus>('/system/runtime')
