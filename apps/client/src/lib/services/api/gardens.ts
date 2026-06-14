import type {
  BackendGardenBuild,
  BackendGardenSite,
  BackendGardenSourceBootstrapResult,
  CreateGardenSiteInput,
  GardenBuildId,
  GardenSiteId,
  RequestGardenBuildInput,
  UpdateGardenSiteInput,
} from '@wonderlands/contracts/chat'
import { apiRequest } from '../backend'

export const listGardens = (): Promise<BackendGardenSite[]> =>
  apiRequest<BackendGardenSite[]>('/gardens')

export const getGardenSite = (gardenSiteId: GardenSiteId | string): Promise<BackendGardenSite> =>
  apiRequest<BackendGardenSite>(`/gardens/${encodeURIComponent(gardenSiteId)}`)

export const createGardenSite = (input: CreateGardenSiteInput): Promise<BackendGardenSite> =>
  apiRequest<BackendGardenSite>('/gardens', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const updateGardenSite = (
  gardenSiteId: GardenSiteId | string,
  input: UpdateGardenSiteInput,
): Promise<BackendGardenSite> =>
  apiRequest<BackendGardenSite>(`/gardens/${encodeURIComponent(gardenSiteId)}`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export const bootstrapGardenSource = (
  gardenSiteId: GardenSiteId | string,
): Promise<BackendGardenSourceBootstrapResult> =>
  apiRequest<BackendGardenSourceBootstrapResult>(
    `/gardens/${encodeURIComponent(gardenSiteId)}/bootstrap-source`,
    {
      method: 'POST',
    },
  )

export const listGardenBuilds = (
  gardenSiteId: GardenSiteId | string,
): Promise<BackendGardenBuild[]> =>
  apiRequest<BackendGardenBuild[]>(`/gardens/${encodeURIComponent(gardenSiteId)}/builds`)

export const getGardenBuild = (
  gardenSiteId: GardenSiteId | string,
  gardenBuildId: GardenBuildId | string,
): Promise<BackendGardenBuild> =>
  apiRequest<BackendGardenBuild>(
    `/gardens/${encodeURIComponent(gardenSiteId)}/builds/${encodeURIComponent(gardenBuildId)}`,
  )

export const requestGardenBuild = (
  gardenSiteId: GardenSiteId | string,
  input: RequestGardenBuildInput = {},
): Promise<BackendGardenBuild> =>
  apiRequest<BackendGardenBuild>(`/gardens/${encodeURIComponent(gardenSiteId)}/builds`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const publishGarden = (gardenSiteId: GardenSiteId | string): Promise<BackendGardenSite> =>
  apiRequest<BackendGardenSite>(`/gardens/${encodeURIComponent(gardenSiteId)}/publish`, {
    method: 'POST',
  })
