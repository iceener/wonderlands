export const shouldRearmDeferredTypewriter = (input: {
  completeFired: boolean
  contentLength: number
  displayedLength: number
  started: boolean
  shouldTypewrite: boolean
  windowActive: boolean
}): boolean =>
  input.shouldTypewrite &&
  input.windowActive &&
  !input.started &&
  !input.completeFired &&
  input.contentLength > 0 &&
  input.displayedLength >= input.contentLength
