import DOMPurify from 'dompurify'
import { Marked } from 'marked'

// A project's Markdown file (e.g. a task's instructions) as a page, for the
// workspace's renderMarkdown. HTML written in the Markdown isn't rendered,
// it shows as text; the result goes through DOMPurify (no scripts, no event
// attributes, no javascript: links); links open in a new tab. Code is only
// shown, never highlighted or run.
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const marked = new Marked({
  gfm: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
  },
})

const purify = DOMPurify()
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false })
  return purify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'] })
}
