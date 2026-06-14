declare const idBrand: unique symbol

type BrandedId<TBrand extends string> = string & { readonly [idBrand]: TBrand }

const brandId = <TBrand extends string>(value: string): BrandedId<TBrand> =>
  value as BrandedId<TBrand>

export type SessionId = BrandedId<'SessionId'>
export type ThreadId = BrandedId<'ThreadId'>
export type MessageId = BrandedId<'MessageId'>
export type RunId = BrandedId<'RunId'>
export type EventId = BrandedId<'EventId'>
export type ToolCallId = BrandedId<'ToolCallId'>
export type ArtifactId = BrandedId<'ArtifactId'>
export type FileId = BrandedId<'FileId'>
export type UploadId = BrandedId<'UploadId'>
export type AgentId = BrandedId<'AgentId'>
export type ToolProfileId = BrandedId<'ToolProfileId'>
export type GardenSiteId = BrandedId<'GardenSiteId'>
export type GardenBuildId = BrandedId<'GardenBuildId'>

export const asSessionId = (value: string): SessionId => brandId<'SessionId'>(value)
export const asThreadId = (value: string): ThreadId => brandId<'ThreadId'>(value)
export const asMessageId = (value: string): MessageId => brandId<'MessageId'>(value)
export const asRunId = (value: string): RunId => brandId<'RunId'>(value)
export const asEventId = (value: string): EventId => brandId<'EventId'>(value)
export const asToolCallId = (value: string): ToolCallId => brandId<'ToolCallId'>(value)
export const asArtifactId = (value: string): ArtifactId => brandId<'ArtifactId'>(value)
export const asFileId = (value: string): FileId => brandId<'FileId'>(value)
export const asUploadId = (value: string): UploadId => brandId<'UploadId'>(value)
export const asAgentId = (value: string): AgentId => brandId<'AgentId'>(value)
export const asToolProfileId = (value: string): ToolProfileId => brandId<'ToolProfileId'>(value)
export const asGardenSiteId = (value: string): GardenSiteId => brandId<'GardenSiteId'>(value)
export const asGardenBuildId = (value: string): GardenBuildId => brandId<'GardenBuildId'>(value)
