import { sanitizeNewsHtml, htmlToPlain } from '../utils/newsHtml'

type Props = {
  html: string
  className?: string
  /** When true, strip tags for one-line preview */
  plain?: boolean
  as?: 'div' | 'p' | 'span'
}

/** Renders sanitized news HTML (or plain text fallback). */
export function NewsHtml({ html, className, plain, as = 'div' }: Props) {
  if (plain) {
    const text = htmlToPlain(html || '')
    if (as === 'span') return <span className={className}>{text}</span>
    if (as === 'p') return <p className={className}>{text}</p>
    return <div className={className}>{text}</div>
  }
  const safe = sanitizeNewsHtml(html || '')
  const Tag = as
  return (
    <Tag
      className={`news-html${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}
