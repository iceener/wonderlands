import { describe, expect, test } from 'vitest'
import { resolveDownloadFileName } from './clipboard'

describe('clipboard helpers', () => {
  test('preserves a preferred image name and appends a mime-derived extension when missing', () => {
    expect(
      resolveDownloadFileName('https://example.com/assets/render', 'Thread shot', 'image/png'),
    ).toBe('Thread shot.png')
  })

  test('keeps an existing preferred extension and strips invalid filename characters', () => {
    expect(
      resolveDownloadFileName('https://example.com/assets/render', 'Board:/shot?.jpg', 'image/png'),
    ).toBe('Board shot.jpg')
  })

  test('falls back to the source path filename when no preferred name is provided', () => {
    expect(resolveDownloadFileName('https://example.com/images/final-frame.webp?size=lg')).toBe(
      'final-frame.webp',
    )
  })

  test('falls back to a generic image filename when neither source nor preferred name includes one', () => {
    expect(resolveDownloadFileName('/v1/files/asset/content', null, 'image/gif')).toBe('image.gif')
  })
})
