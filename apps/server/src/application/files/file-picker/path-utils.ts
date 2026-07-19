import { extname } from 'node:path'

export const normalizeSeparators = (value: string): string => value.replace(/\\/g, '/')

export const toFileExtension = (value: string): string => extname(value).slice(1).toLowerCase()

export const toDepth = (value: string): number => (value.match(/\//g) ?? []).length
