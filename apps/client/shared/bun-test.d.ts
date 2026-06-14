declare module 'bun:test' {
  type ExpectResult = unknown

  interface ExpectFn {
    (value: unknown): ExpectResult
    objectContaining(value: unknown): ExpectResult
  }

  export const describe: (name: string, fn: () => void) => void
  export const test: (name: string, fn: () => void | Promise<void>) => void
  export const it: typeof test
  export const beforeAll: (fn: () => void | Promise<void>) => void
  export const afterAll: (fn: () => void | Promise<void>) => void
  export const beforeEach: (fn: () => void | Promise<void>) => void
  export const afterEach: (fn: () => void | Promise<void>) => void
  export const expect: ExpectFn
}
