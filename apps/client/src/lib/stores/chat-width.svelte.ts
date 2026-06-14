const KEY = 'chat-width'
const DEFAULT = 672
const MIN = 400
const MAX = 1600

function clamp(v: number): number {
  return Math.max(MIN, Math.min(MAX, v))
}

function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    if (Number.isFinite(v)) return clamp(v)
  } catch {}
  return DEFAULT
}

let width = $state(load())

export const chatWidth = {
  get value() {
    return width
  },
  set value(v: number) {
    width = clamp(v)
    try {
      localStorage.setItem(KEY, String(width))
    } catch {}
  },
  DEFAULT,
}
