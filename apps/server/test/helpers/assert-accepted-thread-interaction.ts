import assert from 'node:assert/strict'

export interface AcceptedThreadInteractionBody {
  data: {
    attachedFileIds?: unknown
    inputMessageId?: unknown
    runId?: unknown
    sessionId?: unknown
    status?: unknown
    threadId?: unknown
  }
  ok?: unknown
}

export const assertAcceptedThreadInteraction = (
  response: Response,
  body: AcceptedThreadInteractionBody,
): string => {
  assert.equal(response.status, 202)
  assert.equal(body.ok, true)
  assert.equal(body.data.status, 'accepted')
  assert.equal(typeof body.data.runId, 'string')
  assert.ok(body.data.runId.length > 0)

  return body.data.runId
}
