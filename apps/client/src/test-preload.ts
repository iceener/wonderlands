/**
 * Polyfill OffscreenCanvas so that @chenglou/pretext can call measureText().
 * The widths are heuristic — tests validate relative behavior (taller when
 * narrower, shrinkwrap preserves line count) so exact pixel accuracy is not
 * required here.
 */

const CJK_REGEX = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u
const EMOJI_REGEX = /\p{Extended_Pictographic}/u

const estimateCharWidth = (ch: string, fontSize: number): number => {
  if (ch === ' ') return fontSize * 0.28
  if (ch === '\t') return fontSize * 2.24
  if (EMOJI_REGEX.test(ch) || CJK_REGEX.test(ch)) return fontSize
  if (/[ilI1'`.,:;!|]/.test(ch)) return fontSize * 0.34
  if (/[MW@#%&]/.test(ch)) return fontSize * 0.82
  if (/[A-Z]/.test(ch)) return fontSize * 0.68
  if (/[0-9]/.test(ch)) return fontSize * 0.58
  return fontSize * 0.56
}

const estimateTextWidth = (text: string, fontSize: number): number => {
  let w = 0
  for (const ch of text) w += estimateCharWidth(ch, fontSize)
  return w
}

const parseFontSize = (font: string): number => {
  const match = font.match(/(\d+(?:\.\d+)?)px/)
  return match ? Number.parseFloat(match[1]) : 16
}

class MockOffscreenCanvas {
  width: number
  height: number

  constructor(w: number, h: number) {
    this.width = w
    this.height = h
  }

  getContext(_id: string) {
    let currentFont = '16px sans-serif'

    return {
      get font() {
        return currentFont
      },
      set font(v: string) {
        currentFont = v
      },
      measureText(text: string) {
        const fontSize = parseFontSize(currentFont)
        const width = estimateTextWidth(text, fontSize)
        return {
          width,
          actualBoundingBoxAscent: fontSize * 0.8,
          actualBoundingBoxDescent: fontSize * 0.2,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: width,
          fontBoundingBoxAscent: fontSize * 0.8,
          fontBoundingBoxDescent: fontSize * 0.2,
        }
      },
    }
  }
}

if (typeof globalThis.OffscreenCanvas === 'undefined') {
  ;(globalThis as Record<string, unknown>).OffscreenCanvas = MockOffscreenCanvas
}
