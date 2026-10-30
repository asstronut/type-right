import type { Slip } from '../../lib/slips';
import { lower, raise } from './top-layer';
import { KIND_COLORS } from './underlines';

/** LanguageTool can return dozens of suggestions for a misspelling; only the first few are useful. */
const MAX_SUGGESTIONS = 5;
const GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

const KIND_LABELS: Record<Slip['kind'], string> = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  wording: 'Wording',
  translation: 'Translation',
};

const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const STYLES = `
  :host {
    all: initial;
  }
  .card {
    box-sizing: border-box;
    width: max-content;
    max-width: 320px;
    padding: 12px 14px;
    border: 1px solid #e4e4e7;
    border-radius: 8px;
    background: #ffffff;
    color: #18181b;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    font: 14px/1.45 ${FONT_STACK};
    text-align: left;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 6px;
  }
  .kind {
    flex: none;
    padding: 1px 6px;
    border-radius: 4px;
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .kind.spelling { background: ${KIND_COLORS.spelling}; }
  .kind.grammar { background: ${KIND_COLORS.grammar}; }
  .kind.wording { background: ${KIND_COLORS.wording}; }
  .kind.translation { background: ${KIND_COLORS.translation}; }
  .type {
    font-weight: 600;
  }
  .explanation {
    margin: 0 0 10px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 10px 0 0;
    padding: 8px 0 0;
    border-top: 1px solid #e4e4e7;
  }
  button.quiet {
    border-color: transparent;
    background: transparent;
    color: #52525b;
  }
  button.quiet:hover { background: #f4f4f5; }
  .answer {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .answer li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;
  }
  .suggestion {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .note {
    margin: 8px 0 0;
    font-weight: 600;
  }
  .none {
    color: #71717a;
    font-style: italic;
  }
  button {
    all: unset;
    box-sizing: border-box;
    padding: 3px 10px;
    border: 1px solid #d4d4d8;
    border-radius: 6px;
    background: #f4f4f5;
    color: #18181b;
    font: 13px/1.4 ${FONT_STACK};
    cursor: pointer;
  }
  button:hover { background: #e4e4e7; }
  button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
  button.apply {
    flex: none;
    border-color: #15803d;
    background: #16a34a;
    color: #ffffff;
  }
  button.apply:hover { background: #15803d; }
  @media (prefers-color-scheme: dark) {
    .card { border-color: #3f3f46; background: #18181b; color: #f4f4f5; }
    button { border-color: #52525b; background: #27272a; color: #f4f4f5; }
    button:hover { background: #3f3f46; }
    .none { color: #a1a1aa; }
    .actions { border-top-color: #3f3f46; }
    button.quiet { border-color: transparent; background: transparent; color: #a1a1aa; }
    button.quiet:hover { background: #27272a; }
  }
`;

export interface HoverCardContent {
  slip: Slip;
  /** Present only when the Slip can be fixed in one click. */
  onApply?: (suggestion: string) => void;
  /** Hides this Slip (every occurrence of its word, as ids are per word) in the field. */
  onIgnore: () => void;
  /** Present only for single-word spelling Slips: stops the word being flagged anywhere. */
  onAddToDictionary?: () => void;
  /** Why Apply is gone after a failed attempt; the card then opens with the answer shown. */
  note?: string;
}

/**
 * The page's single Hover card. It lives in a closed Shadow DOM under an
 * unregistered custom tag, so site stylesheets can neither reach its contents
 * nor match its host with element selectors like `div`.
 */
export interface HoverCardOptions {
  /** The pointer entered or left the card, so hover intent can keep it open. */
  onPointerEnter(): void;
  onPointerLeave(): void;
}

export class HoverCard {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private shown: Slip | null = null;

  constructor(options: HoverCardOptions) {
    this.host = document.createElement('type-right-card');
    this.host.popover = 'manual';
    // `all: initial` also takes off the browser's popover box (inset, margin, border, padding, background).
    this.host.style.cssText = ['all: initial', 'position: fixed', 'top: 0', 'left: 0', 'display: none'].join(';');
    this.root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    this.root.appendChild(style);

    this.host.addEventListener('mouseenter', () => options.onPointerEnter());
    this.host.addEventListener('mouseleave', () => options.onPointerLeave());
    // Keep focus (and the caret) in the textarea while the card's buttons are pressed.
    this.root.addEventListener('mousedown', (event) => {
      if ((event.target as Element).closest('button')) event.preventDefault();
    });
  }

  /** Shows the card for `content`, placed beside `anchor` (the underlined text's box), in the top layer with `near`. */
  show(content: HoverCardContent, anchor: DOMRect, near: Element): void {
    this.root.querySelector('.card')?.remove();
    this.root.appendChild(renderCard(content));
    this.shown = content.slip;

    this.host.style.visibility = 'hidden';
    raise(this.host, near);
    this.moveTo(anchor);
    this.host.style.visibility = 'visible';
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = null;
    lower(this.host);
    this.root.querySelector('.card')?.remove();
  }

  /** Takes the card off the page for good. */
  destroy(): void {
    this.hide();
    this.host.remove();
  }

  contains(node: EventTarget | null): boolean {
    return node instanceof Node && this.host.contains(node);
  }

  /** Below the anchor unless only above fits; clamped horizontally to the viewport. */
  moveTo(anchor: DOMRect): void {
    const card = this.host.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    let top = anchor.bottom + GAP_PX;
    if (top + card.height > viewportHeight - VIEWPORT_MARGIN_PX && anchor.top - GAP_PX - card.height >= 0) {
      top = anchor.top - GAP_PX - card.height;
    }
    const maxLeft = viewportWidth - card.width - VIEWPORT_MARGIN_PX;
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(anchor.left, maxLeft));

    this.host.style.top = `${top}px`;
    this.host.style.left = `${left}px`;
  }
}

function renderCard({ slip, onApply, onIgnore, onAddToDictionary, note }: HoverCardContent): HTMLElement {
  const card = el('div', 'card');

  const header = el('div', 'header');
  header.append(el('span', `kind ${slip.kind}`, KIND_LABELS[slip.kind]), el('span', 'type', slip.type));
  card.append(header, el('p', 'explanation', slip.explanation));

  if (note) {
    card.append(renderAnswer(slip, onApply), el('p', 'note', note));
  } else {
    const showAnswer = el('button', 'show-answer', 'Show answer');
    showAnswer.type = 'button';
    showAnswer.addEventListener('click', () => showAnswer.replaceWith(renderAnswer(slip, onApply)));
    card.appendChild(showAnswer);
  }

  const actions = el('div', 'actions');
  actions.appendChild(actionButton('Ignore here', 'Hide this slip everywhere in this field until the page reloads', onIgnore));
  if (onAddToDictionary) {
    actions.appendChild(actionButton('Add to dictionary', 'Never flag this word as a spelling slip again', onAddToDictionary));
  }
  card.appendChild(actions);
  return card;
}

function actionButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', 'quiet', label);
  node.type = 'button';
  node.title = title;
  node.addEventListener('click', onClick);
  return node;
}

function renderAnswer(slip: Slip, onApply: HoverCardContent['onApply']): HTMLElement {
  const suggestions = slip.suggestions.slice(0, MAX_SUGGESTIONS);
  if (suggestions.length === 0) return el('p', 'none', 'No suggestion available.');

  const list = el('ul', 'answer');
  for (const suggestion of suggestions) {
    const item = el('li');
    item.appendChild(el('span', 'suggestion', suggestion));
    if (onApply) {
      const apply = el('button', 'apply', 'Apply');
      apply.type = 'button';
      apply.title = `Replace with "${suggestion}"`;
      apply.addEventListener('click', () => onApply(suggestion));
      item.appendChild(apply);
    }
    list.appendChild(item);
  }
  return list;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
