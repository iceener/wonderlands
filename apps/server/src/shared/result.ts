export type Result<TValue, TError> = { ok: true; value: TValue } | { ok: false; error: TError }

export const ok = <TValue>(value: TValue): Result<TValue, never> => ({
  ok: true,
  value,
})

export const err = <TError>(error: TError): Result<never, TError> => ({
  error,
  ok: false,
})
