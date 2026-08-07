import { useEffect, useRef } from 'react'
import { sanitizeNewsHtml } from '../utils/newsHtml'

type Props = {
  id?: string
  label?: string
  value: string
  onChange: (html: string) => void
  onFocus?: () => void
  minHeight?: number
  placeholder?: string
}

/**
 * Lightweight rich-text field for news (Staff + Partner editors).
 * Stores HTML (sanitized on change). Toolbar: bold, italic, underline, color, size, lists, link.
 */
export function RichTextEditor({
  id,
  label,
  value,
  onChange,
  onFocus,
  minHeight = 140,
  placeholder = 'Write…',
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const lastExternal = useRef<string>('')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const safe = sanitizeNewsHtml(value || '')
    // Avoid resetting caret while typing the same content
    if (safe === lastExternal.current && el.innerHTML === safe) return
    if (document.activeElement === el) return
    el.innerHTML = safe || ''
    lastExternal.current = safe
  }, [value])

  function exec(cmd: string, arg?: string) {
    ref.current?.focus()
    try {
      document.execCommand(cmd, false, arg)
    } catch {
      /* ignore */
    }
    emit()
  }

  function emit() {
    const el = ref.current
    if (!el) return
    const html = sanitizeNewsHtml(el.innerHTML)
    lastExternal.current = html
    onChange(html)
  }

  function onLink() {
    const url = window.prompt('Link URL (https://…)', 'https://')
    if (!url || !/^https?:\/\//i.test(url.trim())) return
    exec('createLink', url.trim())
  }

  return (
    <div className="rte">
      {label ? (
        <label className="rte-label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className="rte-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" className="rte-btn" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
          <strong>B</strong>
        </button>
        <button type="button" className="rte-btn" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
          <em>I</em>
        </button>
        <button type="button" className="rte-btn" title="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>
          <span style={{ textDecoration: 'underline' }}>U</span>
        </button>
        <button type="button" className="rte-btn" title="Strikethrough" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('strikeThrough')}>
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </button>
        <span className="rte-sep" />
        <label className="rte-color" title="Text color">
          <span>A</span>
          <input
            type="color"
            defaultValue="#3dffb0"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => exec('foreColor', e.target.value)}
          />
        </label>
        <select
          className="rte-select"
          title="Font size"
          defaultValue="3"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => exec('fontSize', e.target.value)}
        >
          <option value="1">XS</option>
          <option value="2">S</option>
          <option value="3">M</option>
          <option value="4">L</option>
          <option value="5">XL</option>
          <option value="6">2XL</option>
          <option value="7">3XL</option>
        </select>
        <span className="rte-sep" />
        <button type="button" className="rte-btn" title="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>
          • List
        </button>
        <button type="button" className="rte-btn" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')}>
          1. List
        </button>
        <button type="button" className="rte-btn" title="Link" onMouseDown={(e) => e.preventDefault()} onClick={onLink}>
          Link
        </button>
        <button type="button" className="rte-btn" title="Remove formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')}>
          Clear
        </button>
      </div>
      <div
        id={id}
        ref={ref}
        className="rte-surface input"
        contentEditable
        role="textbox"
        aria-multiline
        tabIndex={0}
        data-placeholder={placeholder}
        style={{ minHeight }}
        onInput={emit}
        onBlur={emit}
        onFocus={() => onFocus?.()}
        onMouseDown={(e) => {
          // Ensure the surface takes focus on every click (Electron can leave caret dead after toolbar)
          if (document.activeElement !== ref.current) {
            ref.current?.focus()
          }
          e.stopPropagation()
        }}
        suppressContentEditableWarning
      />
      <p className="hint rte-hint">Bold · italic · underline · color · size · lists · links (HTML stored safely)</p>
    </div>
  )
}
