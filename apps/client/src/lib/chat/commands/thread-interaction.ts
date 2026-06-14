import type {
  MessageId,
  RunId,
  StartThreadInteractionInput,
  StartThreadInteractionOutput,
  ThreadId,
} from '@wonderlands/contracts/chat'

interface ThreadInteractionCommandsDependencies<Lease, RunLease> {
  applyThreadInteractionStart: (interaction: StartThreadInteractionOutput) => void
  awaitStreamOutcome: (
    streamPromise: Promise<void>,
    runId: RunId,
    viewLease: Lease,
    runLease: RunLease,
  ) => Promise<void>
  captureRunLease: (runId: RunId) => RunLease
  ensureThreadEventStream: (threadId: ThreadId, lease: Lease) => Promise<void>
  replaceMessageId: (currentId: MessageId, nextId: MessageId) => void
  startThreadInteraction: (
    threadId: ThreadId,
    input: StartThreadInteractionInput,
  ) => Promise<StartThreadInteractionOutput>
}

export const createThreadInteractionCommands = <Lease, RunLease>(
  dependencies: ThreadInteractionCommandsDependencies<Lease, RunLease>,
) => {
  const start = async (input: {
    interactionInput: StartThreadInteractionInput
    isCurrentSubmit: () => boolean
    optimisticUserMessageId?: MessageId | null
    threadId: ThreadId
    viewLease: Lease
  }): Promise<boolean> => {
    const streamPromise = dependencies.ensureThreadEventStream(input.threadId, input.viewLease)
    const interaction = await dependencies.startThreadInteraction(
      input.threadId,
      input.interactionInput,
    )
    if (!input.isCurrentSubmit()) {
      return false
    }

    if (input.optimisticUserMessageId) {
      dependencies.replaceMessageId(input.optimisticUserMessageId, interaction.inputMessageId)
    }

    dependencies.applyThreadInteractionStart(interaction)
    await dependencies.awaitStreamOutcome(
      streamPromise,
      interaction.runId,
      input.viewLease,
      dependencies.captureRunLease(interaction.runId),
    )

    return input.isCurrentSubmit()
  }

  return {
    start,
  }
}
