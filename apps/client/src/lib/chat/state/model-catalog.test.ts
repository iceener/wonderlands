import type { BackendModelAlias, BackendModelsCatalog } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import {
  deriveAvailableModels,
  deriveAvailableReasoningModes,
  getSelectedModelAliases,
  pickPreferredModel,
  pickPreferredReasoningMode,
} from './model-catalog'

const alias = (overrides: Partial<BackendModelAlias> = {}): BackendModelAlias => ({
  alias: 'default',
  configured: true,
  contextWindow: 128_000,
  isDefault: false,
  model: 'gpt-5.4',
  provider: 'openai',
  reasoningModes: ['none'],
  supportsReasoning: true,
  ...overrides,
})

const catalog = (overrides: Partial<BackendModelsCatalog> = {}): BackendModelsCatalog => ({
  aliases: [],
  defaultAlias: 'default',
  defaultModel: 'gemini-2.5-flash',
  defaultProvider: 'google',
  providers: {
    google: { configured: true, defaultModel: 'gemini-2.5-flash' },
    openai: { configured: true, defaultModel: 'gpt-5.4' },
    openrouter: { configured: false, defaultModel: '' },
  },
  reasoningModes: [
    { effort: 'none', label: 'None' },
    { effort: 'medium', label: 'Medium' },
    { effort: 'high', label: 'High' },
  ],
  ...overrides,
})

describe('deriveAvailableModels', () => {
  test('always includes the backend default model first', () => {
    const models = deriveAvailableModels(catalog({ aliases: [] }))
    expect(models).toEqual(['default'])
  })

  test('includes configured, distinct alias models after the default', () => {
    const models = deriveAvailableModels(
      catalog({
        aliases: [
          alias({ model: 'gpt-5.4', configured: true }),
          alias({ model: 'gemini-2.5-flash', configured: true }),
          alias({ model: 'gpt-5.4', configured: true }), // duplicate model, should not repeat
        ],
      }),
    )

    expect(models).toEqual(['default', 'gpt-5.4', 'gemini-2.5-flash'])
  })

  test('excludes unconfigured aliases', () => {
    const models = deriveAvailableModels(
      catalog({ aliases: [alias({ model: 'gpt-4.1', configured: false })] }),
    )

    expect(models).toEqual(['default'])
  })
})

describe('pickPreferredModel', () => {
  test('preserves backend default so agent model settings are not overridden', () => {
    expect(pickPreferredModel(['default', 'gemini-2.5-flash', 'gpt-5.4'], null)).toBe('default')
  })

  test('uses the catalog default model when the inherited default option is absent', () => {
    expect(
      pickPreferredModel(['gemini-2.5-flash'], catalog({ defaultModel: 'gemini-2.5-flash' })),
    ).toBe('gemini-2.5-flash')
  })

  test('falls back to the first available model with no catalog', () => {
    expect(pickPreferredModel(['gemini-2.5-flash'], null)).toBe('gemini-2.5-flash')
  })

  test('falls back to the backend default when nothing else is available', () => {
    expect(pickPreferredModel(['default'], null)).toBe('default')
  })
})

describe('getSelectedModelAliases', () => {
  test('returns an empty array when there is no catalog', () => {
    expect(getSelectedModelAliases(null, 'gpt-5.4')).toEqual([])
  })

  test('returns default-flagged aliases when the model is the backend default', () => {
    const defaultAlias = alias({ isDefault: true, model: 'gemini-2.5-flash' })
    const result = getSelectedModelAliases(catalog({ aliases: [defaultAlias, alias()] }), 'default')

    expect(result).toEqual([defaultAlias])
  })

  test('returns configured aliases matching the selected model', () => {
    const match = alias({ model: 'gpt-4.1', configured: true })
    const result = getSelectedModelAliases(
      catalog({ aliases: [match, alias({ model: 'gpt-5.4' })] }),
      'gpt-4.1',
    )

    expect(result).toEqual([match])
  })
})

describe('deriveAvailableReasoningModes', () => {
  test('always includes the default reasoning option first', () => {
    const options = deriveAvailableReasoningModes(null, 'default')
    expect(options).toEqual([{ id: 'default', label: 'default' }])
  })

  test('includes catalog reasoning modes supported by the selected model aliases', () => {
    const options = deriveAvailableReasoningModes(
      catalog({
        aliases: [alias({ isDefault: true, reasoningModes: ['none', 'medium'] })],
      }),
      'default',
    )

    expect(options).toEqual([
      { id: 'default', label: 'default' },
      { id: 'none', label: 'None' },
      { id: 'medium', label: 'Medium' },
    ])
  })

  test('excludes catalog reasoning modes not supported by the selected model', () => {
    const options = deriveAvailableReasoningModes(
      catalog({ aliases: [alias({ isDefault: true, reasoningModes: ['none'] })] }),
      'default',
    )

    // 'medium' and 'high' are advertised by the catalog but not supported by
    // this alias, so they must not appear as selectable reasoning modes.
    expect(options.map((option) => option.id)).toEqual(['default', 'none'])
    expect(options.map((option) => option.id)).not.toContain('medium')
    expect(options.map((option) => option.id)).not.toContain('high')
  })
})

describe('pickPreferredReasoningMode', () => {
  test('preserves default reasoning so agent reasoning settings are not overridden', () => {
    const options = [
      { id: 'default', label: 'default' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ]

    expect(pickPreferredReasoningMode(options)).toBe('default')
  })

  test('falls back to the first available mode when default is unavailable', () => {
    const options = [{ id: 'high', label: 'High' }]

    expect(pickPreferredReasoningMode(options)).toBe('high')
  })

  test('returns the backend default when the only explicit mode is none', () => {
    const options = [
      { id: 'default', label: 'default' },
      { id: 'none', label: 'None' },
    ]

    expect(pickPreferredReasoningMode(options)).toBe('default')
  })

  test('returns the backend default when there are no explicit modes', () => {
    expect(pickPreferredReasoningMode([{ id: 'default', label: 'default' }])).toBe('default')
  })
})
