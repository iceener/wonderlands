export interface ApiMeta {
  requestId: string
  traceId: string
}

export interface ApiSuccessEnvelope<TData> {
  data: TData
  meta: ApiMeta
  ok: true
}

export interface ApiErrorEnvelope {
  error: {
    message: string
    type: string
  }
  meta: ApiMeta
  ok: false
}

export type ApiEnvelope<TData> = ApiSuccessEnvelope<TData> | ApiErrorEnvelope
