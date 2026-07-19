import { describe, expect, test } from 'vitest'

import {
  aspectRatioToDecimal,
  completionKey,
  formatDurationLabel,
  formatSandboxNetworkMode,
  formatSandboxProvider,
  formatSandboxRuntime,
  highlightCode,
  highlightJson,
  parseImageToolArgs,
  parseImageToolOutput,
  parseSandboxExecution,
  parseToolErrorMessage,
  sandboxStatusClass,
  sandboxStatusLabel,
  toolDurationMs,
  extractSandboxScript,
} from './tool-block-logic'

describe('tool-block-logic', () => {
  test('formats durations and completion keys', () => {
    expect(formatDurationLabel(null)).toBeNull()
    expect(formatDurationLabel(120)).toBe('120ms')
    expect(formatDurationLabel(1500)).toBe('1.5s')
    expect(completionKey({ toolCallId: 'call-1', status: 'running' } as never)).toBe('call-1:')
  })

  test('parses sandbox execution details from nested or flat payloads', () => {
    const parsed = parseSandboxExecution({
      details: {
        files: [],
        sandboxExecutionId: 'run-1',
        status: 'completed',
        writebacks: [],
      },
    })

    expect(parsed?.sandboxExecutionId).toBe('run-1')
    expect(parsed?.status).toBe('completed')
    expect(parseSandboxExecution({ sandboxExecutionId: 'run-1', files: [{}], status: 'completed', writebacks: [] })).toBeNull()
  })

  test('parses generate image outputs and args', () => {
    expect(parseImageToolArgs({ aspectRatio: '16:9', references: [{}, {}] })).toEqual({
      aspectRatio: '16:9',
      count: 2,
    })

    expect(
      parseImageToolOutput({
        imageCount: 1,
        images: [{ fileId: 'file-1', name: 'generated' }],
      }),
    ).toMatchObject({ imageCount: 1, images: [{ fileId: 'file-1', mimeType: 'image/png', name: 'generated' }] })
  })

  test('formats sandbox metadata labels', () => {
    expect(formatSandboxNetworkMode('allow_list')).toBe('Allow list')
    expect(formatSandboxProvider('deno')).toBe('deno')
    expect(formatSandboxRuntime('node')).toBe('Node compat')
    expect(sandboxStatusLabel('pending')).toBe('Pending approval')
    expect(sandboxStatusClass('rejected')).toBe('text-danger-text')
  })

  test('highlights code and falls back safely', () => {
    expect(highlightJson('{"a":1}')).toContain('hljs')
    expect(highlightCode('const a = 1', 'javascript')).toContain('hljs')
  })

  test('parses tool errors and sandbox script payloads', () => {
    expect(parseToolErrorMessage({ error: { message: 'boom' } })).toBe('boom')
    expect(extractSandboxScript({ source: { script: 'echo hi', kind: 'bash' } })?.lang).toBe('bash')
  })

  test('converts ratios and duration values', () => {
    expect(aspectRatioToDecimal('16:9')).toBeCloseTo(16 / 9)
    expect(aspectRatioToDecimal(null)).toBe(1)
    expect(toolDurationMs({ status: 'complete', createdAt: '2025-01-01T00:00:00.000Z', finishedAt: '2025-01-01T00:00:01.000Z' } as never)).toBe(1000)
  })
})
