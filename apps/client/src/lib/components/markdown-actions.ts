import type { Action } from 'svelte/action'
import { collectLightboxableImages } from '../preview/preview-adapters'
import type { PreviewController } from '../preview/preview-controller.svelte'
import { isAuthenticatedAssetUrl, resolveImageDisplayUrl } from '../services/authenticated-asset'
import {
  copyImageToClipboard,
  copyTextToClipboard,
  downloadImage,
  resolveDownloadFileName,
} from '../services/clipboard'

const showButtonFeedback = (button: HTMLButtonElement, label: string) => {
  const previousText = button.dataset.feedbackText ?? button.textContent ?? ''
  button.dataset.feedbackText = previousText
  button.textContent = label

  window.setTimeout(() => {
    if (button.isConnected) {
      button.textContent = previousText
    }
  }, 1200)
}

const createMessageImageActionButton = (
  label: 'Copy' | 'Download',
  datasetKey: 'copyImage' | 'downloadImage',
): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'sd-message-image-button'
  button.textContent = label
  button.dataset[datasetKey] = ''
  return button
}

const extensionForLanguage = (language: string): string => {
  const normalized = language.toLowerCase()
  switch (normalized) {
    case 'javascript':
    case 'js':
      return 'js'
    case 'typescript':
    case 'ts':
      return 'ts'
    case 'json':
      return 'json'
    case 'markdown':
    case 'md':
      return 'md'
    case 'html':
    case 'xml':
      return 'html'
    case 'css':
      return 'css'
    case 'bash':
    case 'shell':
    case 'sh':
      return 'sh'
    default:
      return normalized || 'txt'
  }
}

const downloadCode = (code: string, language: string) => {
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `snippet.${extensionForLanguage(language)}`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(href)
}

const resolveAuthenticatedImageSrc = (img: HTMLImageElement, sourceUrl: string) => {
  if (!isAuthenticatedAssetUrl(sourceUrl) || img.dataset.authResolved) {
    return
  }

  img.dataset.authResolved = '1'

  void resolveImageDisplayUrl(sourceUrl)
    .then((resolved) => {
      if (!img.isConnected) {
        resolved.dispose()
        return
      }

      img.src = resolved.displayUrl
      img.dataset.authObjectUrl = resolved.displayUrl

      const observer = new MutationObserver(() => {
        if (!img.isConnected) {
          observer.disconnect()
          resolved.dispose()
        }
      })

      observer.observe(img.ownerDocument.body, { childList: true, subtree: true })
    })
    .catch(() => {
      // Leave the original src as fallback.
    })
}

const decorateMessageImages = (rootEl: HTMLDivElement) => {
  for (const img of rootEl.querySelectorAll('img')) {
    const sourceUrl = (img.getAttribute('src') || img.currentSrc || '').trim()
    if (!sourceUrl) {
      continue
    }

    resolveAuthenticatedImageSrc(img, sourceUrl)

    if (img.closest('[data-message-image]')) {
      continue
    }

    const parentAnchor =
      img.parentElement instanceof HTMLAnchorElement && img.parentElement.childElementCount === 1
        ? img.parentElement
        : null
    const host = parentAnchor ?? img
    const wrapper = document.createElement('span')
    const actions = document.createElement('span')

    wrapper.className = 'sd-message-image'
    wrapper.dataset.messageImage = ''
    wrapper.dataset.imageAlt = (img.getAttribute('alt') || 'Image').trim() || 'Image'
    wrapper.dataset.imageSrc = sourceUrl

    actions.className = 'sd-message-image-actions'
    actions.append(
      createMessageImageActionButton('Copy', 'copyImage'),
      createMessageImageActionButton('Download', 'downloadImage'),
    )

    host.replaceWith(wrapper)
    wrapper.append(host, actions)
  }
}

const handleCodeAction = async (button: HTMLButtonElement) => {
  const codeBlock = button.closest<HTMLElement>('[data-code-block]')
  const codeElement = codeBlock?.querySelector<HTMLElement>('pre code')
  const code = codeElement?.textContent ?? ''
  const language = codeBlock?.dataset.language ?? 'text'

  if (!code) {
    return
  }

  if ('copyCode' in button.dataset) {
    await copyTextToClipboard(code)
    showButtonFeedback(button, 'Copied')
  }

  if ('downloadCode' in button.dataset) {
    downloadCode(code, language)
    showButtonFeedback(button, 'Saved')
  }
}

const handleImageAction = async (button: HTMLButtonElement) => {
  const wrapper = button.closest<HTMLElement>('[data-message-image]')
  const sourceUrl = wrapper?.dataset.imageSrc?.trim() ?? ''
  const alt = wrapper?.dataset.imageAlt?.trim() || 'Image'

  if (!sourceUrl) {
    return
  }

  if ('copyImage' in button.dataset) {
    await copyImageToClipboard(sourceUrl)
    showButtonFeedback(button, 'Copied')
    return
  }

  if ('downloadImage' in button.dataset) {
    await downloadImage(sourceUrl, resolveDownloadFileName(sourceUrl, alt))
    showButtonFeedback(button, 'Saved')
  }
}

const handleRootClick = async (
  rootEl: HTMLDivElement,
  preview: PreviewController | undefined,
  event: MouseEvent,
) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }

  const button = target.closest<HTMLButtonElement>(
    '[data-copy-code], [data-download-code], [data-copy-image], [data-download-image]',
  )

  if (button) {
    event.preventDefault()
    event.stopPropagation()

    try {
      if ('copyImage' in button.dataset || 'downloadImage' in button.dataset) {
        await handleImageAction(button)
      } else {
        await handleCodeAction(button)
      }
    } catch {
      showButtonFeedback(button, 'Failed')
    }

    return
  }

  if (!preview) {
    return
  }

  if (target instanceof Element) {
    const img = target.closest('img')
    if (img && rootEl.contains(img)) {
      const root = rootEl.closest<HTMLElement>('[data-lightbox-gallery]') ?? rootEl
      const { items, elements } = collectLightboxableImages(root)
      const index = elements.indexOf(img as HTMLImageElement)
      if (index >= 0 && items.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        preview.openGallery(items, index)
      }
    }
  }
}

export const createMarkdownActions = (
  preview?: PreviewController,
): Action<HTMLDivElement, unknown> => {
  return (rootEl) => {
    decorateMessageImages(rootEl)

    const onClick = (event: MouseEvent) => {
      void handleRootClick(rootEl, preview, event)
    }

    rootEl.addEventListener('click', onClick)

    return {
      update() {
        decorateMessageImages(rootEl)
      },
      destroy() {
        rootEl.removeEventListener('click', onClick)
      },
    }
  }
}
