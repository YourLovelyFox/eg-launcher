/**
 * Sanitize HTML allowed in news title/summary/body for safe display.
 * Staff editors insert formatting via RichTextEditor (b/i/u/color/size/lists/links).
 */
const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'br',
  'p',
  'div',
  'span',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'font',
  'blockquote',
  'code',
  'pre',
])

function sanitizeStyle(style: string): string {
  const out: string[] = []
  const parts = style.split(';')
  for (const part of parts) {
    const [rawK, ...rest] = part.split(':')
    if (!rawK || rest.length === 0) continue
    const k = rawK.trim().toLowerCase()
    const v = rest.join(':').trim()
    if (!v) continue
    if (k === 'color' || k === 'background-color') {
      if (/^(#[0-9a-f]{3,8}|rgb\([\d\s,%.]+\)|rgba\([\d\s,%.]+\)|[a-z]+)$/i.test(v)) {
        out.push(`${k}: ${v}`)
      }
    } else if (k === 'font-size') {
      if (/^\d+(\.\d+)?(px|pt|em|rem|%)$/i.test(v)) out.push(`${k}: ${v}`)
    } else if (k === 'font-weight') {
      if (/^(bold|normal|[1-9]00)$/i.test(v)) out.push(`${k}: ${v}`)
    } else if (k === 'font-style') {
      if (/^(italic|normal)$/i.test(v)) out.push(`${k}: ${v}`)
    } else if (k === 'text-decoration') {
      if (/^(underline|line-through|none)(\s+(underline|line-through|none))*$/i.test(v)) {
        out.push(`${k}: ${v}`)
      }
    } else if (k === 'text-align') {
      if (/^(left|right|center|justify)$/i.test(v)) out.push(`${k}: ${v}`)
    }
  }
  return out.join('; ')
}

/** Convert plain text (no tags) to simple HTML paragraphs. */
export function plainToHtml(text: string): string {
  if (!text) return ''
  if (/<[a-z][\s\S]*>/i.test(text)) return text
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

/** Strip tags for card previews / lists. */
export function htmlToPlain(html: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function sanitizeNewsHtml(input: string): string {
  if (!input || typeof input !== 'string') return ''
  // If plain text, keep newlines as br
  if (!/<[a-z][\s\S]*>/i.test(input)) {
    return plainToHtml(input)
  }

  try {
    const doc = new DOMParser().parseFromString(`<div id="root">${input}</div>`, 'text/html')
    const root = doc.getElementById('root')
    if (!root) return plainToHtml(input)

    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return ''
      const el = node as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
        return ''
      }
      if (!ALLOWED_TAGS.has(tag)) {
        return Array.from(el.childNodes).map(walk).join('')
      }

      let attrs = ''
      if (tag === 'a') {
        const href = el.getAttribute('href') || ''
        if (/^https?:\/\//i.test(href)) {
          attrs += ` href="${href.replace(/"/g, '')}" rel="noopener noreferrer" target="_blank"`
        } else {
          return Array.from(el.childNodes).map(walk).join('')
        }
      }
      if (tag === 'span' || tag === 'p' || tag === 'div' || tag === 'font' || tag === 'li') {
        const style = el.getAttribute('style')
        if (style) {
          const safe = sanitizeStyle(style)
          if (safe) attrs += ` style="${safe}"`
        }
        if (tag === 'font') {
          const color = el.getAttribute('color')
          if (color && /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(color)) {
            attrs += ` style="color: ${color}"`
          }
          const size = el.getAttribute('size')
          if (size && /^[1-7]$/.test(size)) {
            const px = ['10', '12', '14', '16', '18', '24', '32'][Number(size) - 1] || '14'
            attrs += attrs.includes('style=')
              ? ''
              : ` style="font-size: ${px}px"`
            if (attrs.includes('style=') && size) {
              // merge into existing style attr roughly
            }
          }
          // Prefer span
          const inner = Array.from(el.childNodes).map(walk).join('')
          const st = el.getAttribute('style')
          const c = el.getAttribute('color')
          const parts: string[] = []
          if (c && /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(c)) parts.push(`color: ${c}`)
          if (st) {
            const s = sanitizeStyle(st)
            if (s) parts.push(s)
          }
          if (size && /^[1-7]$/.test(size)) {
            const px = ['10', '12', '14', '16', '18', '24', '32'][Number(size) - 1] || '14'
            parts.push(`font-size: ${px}px`)
          }
          if (parts.length) return `<span style="${parts.join('; ')}">${inner}</span>`
          return inner
        }
      }

      const inner = Array.from(el.childNodes).map(walk).join('')
      if (tag === 'br') return '<br>'
      return `<${tag}${attrs}>${inner}</${tag}>`
    }

    return Array.from(root.childNodes).map(walk).join('')
  } catch {
    return plainToHtml(input)
  }
}
