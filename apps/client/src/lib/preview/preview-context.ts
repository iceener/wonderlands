import { getContext, hasContext, setContext } from 'svelte'
import type { PreviewController } from './preview-controller.svelte'

const PREVIEW_CONTEXT = Symbol('preview-controller')

export const setPreviewContext = (controller: PreviewController): PreviewController => {
  setContext(PREVIEW_CONTEXT, controller)
  return controller
}

export const getPreviewContext = (): PreviewController =>
  getContext<PreviewController>(PREVIEW_CONTEXT)

export const tryGetPreviewContext = (): PreviewController | undefined =>
  hasContext(PREVIEW_CONTEXT) ? getContext<PreviewController>(PREVIEW_CONTEXT) : undefined
