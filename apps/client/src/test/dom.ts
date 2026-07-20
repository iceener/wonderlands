export const installDomPolyfills = (): void => {
  if (!document.elementFromPoint) {
    document.elementFromPoint = () => null
  }

  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    })
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined
  }

  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    }
  }

  if (!document.fonts) {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    })
  }
}

export const createMountTarget = (): HTMLDivElement => {
  const target = document.createElement('div')
  document.body.append(target)
  return target
}

export const dispatchPaste = (target: Element, values: Record<string, string>): Event => {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [],
      getData: (type: string) => values[type] ?? '',
      items: [],
      types: Object.keys(values),
    },
  })
  target.dispatchEvent(event)
  return event
}
