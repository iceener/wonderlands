export interface Clock {
  now: () => Date
  nowIso: () => string
}

export const createSystemClock = (): Clock => ({
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
})
