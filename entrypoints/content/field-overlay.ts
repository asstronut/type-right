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

export const KIND_COLORS: Record<CheckError['kind'], string> = {
  spelling: '#e11d48',
  grammar: '#2563eb',
  wording: '#7c3aed',
};

/** The underline is drawn just below the glyphs; count it as part of the hover target. */
const UNDERLINE_HIT_SLOP_PX = 4;

export interface ErrorHit {
  error: CheckError;
  /** The box of the underlined line under the pointer, for placing the Hover card. */
  rect: DOMRect;
}

/**
 * Mirrors a textarea's box and typography in a same-sized, invisible-text
 * overlay so underline spans land exactly under the right characters.
 * Positioned with `fixed` + the field's own bounding rect, rather than as a
 * positioned sibling, so it never touches the host page's layout or CSS.
 */
export class FieldOverlay {
  private readonly field: HTMLTextAreaElement;
  private readonly el: HTMLDivElement;
  private spans: { span: HTMLSpanElement; error: CheckError }[] = [];

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

  /**
   * The rendered Error under a viewport point, if any. The overlay ignores the
   * pointer (so the textarea keeps working), which is why hovering is done by
   * hit-testing its spans rather than by listening on them.
   */
  errorAt(x: number, y: number): ErrorHit | undefined {
    const visible = this.el.getBoundingClientRect();
    if (x < visible.left || x > visible.right || y < visible.top || y > visible.bottom) return undefined;
    for (const { span, error } of this.spans) {
      for (const rect of span.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom + UNDERLINE_HIT_SLOP_PX) {
          return { error, rect };
        }
      }
    }
    return undefined;
  }

  clear(): void {
    this.el.replaceChildren();
    this.spans = [];
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
    this.spans = [];
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
      span.style.textDecorationColor = KIND_COLORS[error.kind];
      span.style.textDecorationThickness = '3px';
      // Default "auto" breaks the line around descenders (y, g, p...), which looks like a cut-off underline.
      span.style.textDecorationSkipInk = 'none';
      this.el.appendChild(span);
      this.spans.push({ span, error });
      cursor = error.end;
    }
    // A trailing newline adds an empty line in a textarea but not in a div; the
    // zero-width char keeps both the same scroll height.
    this.el.appendChild(document.createTextNode(`${text.slice(cursor)}​`));
  }
}
