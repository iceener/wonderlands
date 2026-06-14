import DOMPurify from 'dompurify'
import { track } from '../../utils/perf'

const sanitizeConfig = {
  ADD_ATTR: [
    'aria-hidden',
    'aria-label',
    'data-agent-id',
    'data-agent-mention',
    'data-code-block',
    'data-file-mention',
    'data-copy-code',
    'data-download-code',
    'data-language',
    'data-source',
    'tabindex',
    'target',
    'rel',
    'loading',
    'decoding',
  ],
  ADD_TAGS: ['button'],
}

export const sanitizeHtml = (html: string): string => {
  if (typeof window === 'undefined') {
    return html
  }

  return track('dompurify', () => DOMPurify.sanitize(html, sanitizeConfig))
}
