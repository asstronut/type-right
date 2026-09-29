import type { CheckError } from '../../lib/errors';

const MIRROR_PROPERTIES = [
  'box-sizing',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-style',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-indent',
  'text-align',
  'text-transform',
  'word-spacing',
  'white-space',
  'word-wrap',
  'word-break',
  'overflow-wrap',
  'tab-size',
] as const;

/**
 * Mirrors a textarea's box and typography in a same-sized, invisible-text
 * overlay so underline spans land exactly under the right characters.
 * Positioned with `fixed` + the field's own bounding rect, rather than as a
 * positioned sibling, so it never touches the host page's layout or CSS.
 */
export class FieldOverlay {
  private readonly field: HTMLTextAreaElement;
  private readonly el: HTMLDivElement;

  constructor(field: HTMLTextAreaElement) {
    this.field = field;
    this.el = document.createElement('div');
    this.el.setAttribute('data-type-right-overlay', '');
    Object.assign(this.el.style, {
      position: 'fixed',
      margin: '0',
      overflow: 'hidden',
      color: 'transparent',
      background: 'transparent',
      pointerEvents: 'none',
      zIndex: '2147483647',
    });
    document.documentElement.appendChild(this.el);

    field.addEventListener('scroll', () => this.syncScroll());
  }

  render(text: string, errors: CheckError[]): void {
    if (this.field.value !== text) return; // a newer keystroke has already superseded this response
    this.reposition();
    this.renderSpans(text, errors);
  }

  /** Re-syncs position/scroll only, without touching the rendered content. */
  reposition(): void {
    this.syncGeometry();
    this.syncScroll();
  }

  clear(): void {
    this.el.replaceChildren();
  }

  destroy(): void {
    this.el.remove();
  }

  private syncGeometry(): void {
    const rect = this.field.getBoundingClientRect();
    const computed = getComputedStyle(this.field);

    this.el.style.top = `${rect.top}px`;
    this.el.style.left = `${rect.left}px`;
    // Exclude the textarea's scrollbar so text wraps at the same column.
    const borders = parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth);
    this.el.style.width = `${this.field.clientWidth + borders}px`;
    this.el.style.height = `${rect.height}px`;

    for (const prop of MIRROR_PROPERTIES) {
      this.el.style.setProperty(prop, computed.getPropertyValue(prop));
    }
  }

  private syncScroll(): void {
    this.el.scrollTop = this.field.scrollTop;
    this.el.scrollLeft = this.field.scrollLeft;
  }

  private renderSpans(text: string, errors: CheckError[]): void {
    this.el.replaceChildren();
    const sorted = [...errors].sort((a, b) => a.start - b.start);

    let cursor = 0;
    for (const error of sorted) {
      if (error.start < cursor || error.end > text.length || error.end <= error.start) continue;
      if (error.start > cursor) {
        this.el.appendChild(document.createTextNode(text.slice(cursor, error.start)));
      }
      const span = document.createElement('span');
      span.textContent = text.slice(error.start, error.end);
      span.style.textDecorationLine = 'underline';
      span.style.textDecorationStyle = 'solid';
      span.style.textDecorationColor = colorForKind(error.kind);
      span.style.textDecorationThickness = '3px';
      this.el.appendChild(span);
      cursor = error.end;
    }
    // A trailing newline adds an empty line in a textarea but not in a div; the
    // zero-width char keeps both the same scroll height.
    this.el.appendChild(document.createTextNode(`${text.slice(cursor)}​`));
  }
}

function colorForKind(kind: CheckError['kind']): string {
  switch (kind) {
    case 'spelling':
      return '#e11d48';
    case 'grammar':
      return '#2563eb';
    case 'wording':
      return '#7c3aed';
  }
}
