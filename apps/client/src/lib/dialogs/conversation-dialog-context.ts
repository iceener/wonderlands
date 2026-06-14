import { getContext, setContext } from 'svelte'
import type { ConversationDialogController } from './conversation-dialog-controller.svelte'

const CONVERSATION_DIALOG_CONTEXT = Symbol('conversation-dialog')

export const setConversationDialogContext = (
  controller: ConversationDialogController,
): ConversationDialogController => {
  setContext(CONVERSATION_DIALOG_CONTEXT, controller)
  return controller
}

export const getConversationDialogContext = (): ConversationDialogController =>
  getContext<ConversationDialogController>(CONVERSATION_DIALOG_CONTEXT)
