import type { LlmHealth } from '../../lib/checker';
import type { LlmFailure } from '../../lib/engine';
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

const LT_STILL_WORKS = 'LanguageTool underlines keep working.';

const FAILURE_REASONS: Record<LlmFailure, string> = {
  'no-key': 'No API key is set, or the provider rejected it. Set one in the Type Right options.',
  quota: "The API key's quota or rate limit is used up. Retrying in a minute.",
  network: "The LLM provider can't be reached. Retrying in a minute.",
  timeout: 'The LLM took more than 8 seconds to answer. Retrying in a minute.',
  'bad-response': 'The LLM provider sent an unexpected response. Retrying in a minute.',
};

/** What the field's LLM badge shows for each LLM health. */
function badgeFor(health: LlmHealth): { label: string; color: string; title: string } {
  switch (health.state) {
    case 'active':
      return { label: 'LLM', color: '#16a34a', title: 'Finished sentences are also checked by the LLM.' };
    case 'lt-only':
      return {
        label: 'LT only',
        color: '#6b7280',
        title:
          health.reason === 'no-consent'
            ? 'Only LanguageTool checks this field: sending text to the LLM is not allowed. Change this in the Type Right options.'
            : 'Only LanguageTool checks this field: this site is excluded from the LLM.',
      };
    case 'failing':
      return { label: 'LLM', color: '#dc2626', title: `LLM paused. ${FAILURE_REASONS[health.reason]} ${LT_STILL_WORKS}` };
  }
}

/** Keeps the badge clear of the textarea's resize grip in the bottom-right corner. */
const BADGE_INSET_PX = { right: 18, bottom: 4 };

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
  /** Says whether the field's text goes to the LLM; hovering it tells why. */
  private readonly badge: HTMLDivElement;
  private spans: { span: HTMLSpanElement; error: CheckError }[] = [];
  private readonly listeners = new AbortController();

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

    this.badge = document.createElement('div');
    this.badge.setAttribute('data-type-right-badge', '');
    Object.assign(this.badge.style, {
      position: 'fixed',
      display: 'none',
      padding: '1px 5px',
      borderRadius: '8px',
      font: '600 10px/14px system-ui, sans-serif',
      color: '#fff',
      opacity: '0.85',
      cursor: 'default',
      userSelect: 'none',
      zIndex: '2147483647',
    });
    document.documentElement.appendChild(this.badge);

    field.addEventListener('scroll', () => this.syncScroll(), { signal: this.listeners.signal });
  }

  render(text: string, errors: CheckError[]): void {
    if (this.field.value !== text) return; // a newer keystroke has already superseded this response
    this.reposition();
    this.renderSpans(text, errors);
  }

  setLlmHealth(health: LlmHealth): void {
    const { label, color, title } = badgeFor(health);
    this.badge.textContent = label;
    this.badge.title = title;
    this.badge.style.background = color;
    this.syncBadge();
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
    this.listeners.abort();
    this.el.remove();
    this.badge.remove();
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
    this.syncBadge();
  }

  private syncBadge(): void {
    if (!this.badge.textContent) return;
    const rect = this.field.getBoundingClientRect();
    // A hidden field has no box; neither should its badge.
    if (!rect.width || !rect.height) {
      this.badge.style.display = 'none';
      return;
    }
    this.badge.style.display = 'block';
    this.badge.style.left = `${rect.right - BADGE_INSET_PX.right - this.badge.offsetWidth}px`;
    this.badge.style.top = `${rect.bottom - BADGE_INSET_PX.bottom - this.badge.offsetHeight}px`;
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
