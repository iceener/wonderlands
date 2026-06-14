import { describe, expect, test } from 'vitest'
import {
  getModelVisibleImageComparisonKey,
  getUploadedAssetIdFromUrl,
  listMarkdownImageReferences,
  normalizeModelVisibleImageMarkdown,
  parseModelVisibleImageSource,
} from './markdown-images'

describe('markdown image helpers', () => {
  test('lists markdown image references in document order', () => {
    const references = listMarkdownImageReferences(`
# Heading

Alpha ![Chart](/api/uploads/asset-1/chart.png) bravo.

![Photo](https://example.com/photo.png "Example")
`)

    expect(references).toEqual([
      {
        alt: 'Chart',
        raw: '![Chart](/api/uploads/asset-1/chart.png)',
        title: null,
        url: '/api/uploads/asset-1/chart.png',
      },
      {
        alt: 'Photo',
        raw: '![Photo](https://example.com/photo.png "Example")',
        title: 'Example',
        url: 'https://example.com/photo.png',
      },
    ])
  })

  test('parses uploaded image URLs into stable comparison keys', () => {
    expect(parseModelVisibleImageSource('/v1/files/fil_1/content')).toEqual({
      ok: true,
      value: {
        kind: 'local-upload',
        url: '/v1/files/fil_1/content',
        assetId: 'fil_1',
        comparisonKey: 'upload:fil_1',
      },
    })

    expect(parseModelVisibleImageSource('/api/uploads/asset-1/chart.png')).toEqual({
      ok: true,
      value: {
        kind: 'local-upload',
        url: '/api/uploads/asset-1/chart.png',
        assetId: 'asset-1',
        comparisonKey: 'upload:asset-1',
      },
    })

    expect(getUploadedAssetIdFromUrl('/v1/files/fil_1/content')).toBe('fil_1')
    expect(getUploadedAssetIdFromUrl('/api/uploads/asset-1/chart.png')).toBe('asset-1')
    expect(getModelVisibleImageComparisonKey('/v1/files/fil_1/content')).toBe('upload:fil_1')
    expect(getModelVisibleImageComparisonKey('/api/uploads/asset-1/chart.png')).toBe(
      'upload:asset-1',
    )
  })

  test('normalizes remote image URLs for deduplication', () => {
    expect(parseModelVisibleImageSource('https://example.com/preview.png#fragment')).toEqual({
      ok: true,
      value: {
        kind: 'remote',
        url: 'https://example.com/preview.png',
        comparisonKey: 'remote:https://example.com/preview.png',
      },
    })
  })

  test('rejects unsupported relative and non-http image URLs', () => {
    expect(parseModelVisibleImageSource('/images/chart.png')).toEqual({
      ok: false,
      error: {
        reason: 'unsupported_relative_url',
        url: '/images/chart.png',
        message:
          'Only uploaded image URLs under /v1/files/*/content or /api/uploads/ and absolute http(s) image URLs are supported.',
      },
    })

    expect(parseModelVisibleImageSource('blob:http://localhost/image-1')).toEqual({
      ok: false,
      error: {
        reason: 'unsupported_scheme',
        url: 'blob:http://localhost/image-1',
        message:
          'Unsupported image URL scheme "blob:". Only http(s) URLs and uploaded image URLs are supported.',
      },
    })
  })

  test('unwraps autolinked markdown links nested inside image destinations', () => {
    expect(
      parseModelVisibleImageSource(
        '[https://example.com/preview.png](https://example.com/preview.png)',
      ),
    ).toEqual({
      ok: true,
      value: {
        kind: 'remote',
        url: 'https://example.com/preview.png',
        comparisonKey: 'remote:https://example.com/preview.png',
      },
    })

    expect(
      normalizeModelVisibleImageMarkdown(
        '![Inline]([https://example.com/preview.png](https://example.com/preview.png))',
      ),
    ).toBe('![Inline](https://example.com/preview.png)')
  })
})
