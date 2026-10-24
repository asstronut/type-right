import type { LlmFailure } from '../../lib/engine';
import type { LlmHealth } from '../../lib/llm-health';
import { lower, raise } from './top-layer';
import { visibleBox } from './visible-box';

const LT_STILL_WORKS = 'LanguageTool underlines keep working.';

const FAILURE_REASONS: Record<LlmFailure, string> = {
  'no-key': 'No API key is set, or the provider rejected it. Set one in the Type Right options.',
  quota: "The API key's quota or rate limit is used up. Retrying in a minute.",
  network: "The LLM provider can't be reached. Retrying in a minute.",
  timeout: 'The LLM took more than 8 seconds to answer. Retrying in a minute.',
  'bad-response': 'The LLM provider sent an unexpected response. Retrying in a minute.',
};

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

/** From the visible box's bottom-right corner; a textarea's is wider to keep clear of its resize grip. */
const TEXTAREA_INSET_PX = { right: 18, bottom: 4 };
const RICH_EDITOR_INSET_PX = { right: 4, bottom: 4 };
const IDLE_OPACITY = '0.85';
const TYPING_OPACITY = '0.25';
const FADE_BACK_MS = 1500;

interface Spot {
  left: number;
  top: number;
}

export interface Badge {
  setLlmHealth(health: LlmHealth): void;
  followMove(): void;
  destroy(): void;
}

/**
 * Says in the bottom-right corner of what shows of `element` whether the
 * Field's text goes to the LLM; hovering it tells why. It moves up the right
 * edge while site UI covers that corner, hides when no spot is clear or
 * nothing of the element shows, and fades while the user types.
 */
export function createBadge(element: HTMLElement): Badge {
  const badge = document.createElement('div');
  badge.setAttribute('data-type-right-badge', '');
  badge.popover = 'manual';
  Object.assign(badge.style, {
    position: 'fixed',
    inset: 'auto',
    margin: '0',
    border: '0',
    overflow: 'visible',
    display: 'none',
    padding: '1px 5px',
    borderRadius: '8px',
    font: '600 10px/14px system-ui, sans-serif',
    color: '#fff',
    opacity: IDLE_OPACITY,
    cursor: 'default',
    userSelect: 'none',
  });
  document.documentElement.appendChild(badge);
  const inset = element instanceof HTMLTextAreaElement ? TEXTAREA_INSET_PX : RICH_EDITOR_INSET_PX;

  function place(): void {
    frame = undefined;
    const box = badge.textContent ? visibleBox(element) : undefined;
    if (!box) return lower(badge);
    raise(badge, element);
    const spot = clearSpotIn(box, badge.offsetWidth, badge.offsetHeight);
    if (!spot) return lower(badge);
    badge.style.left = `${spot.left}px`;
    badge.style.top = `${spot.top}px`;
  }

  function clearSpotIn(box: DOMRect, width: number, height: number): Spot | undefined {
    const left = box.right - inset.right - width;
    for (let top = box.bottom - inset.bottom - height; top >= box.top; top -= height) {
      if (isWhollyUncovered(left, top, width, height)) return { left, top };
    }
    return undefined;
  }

  function isWhollyUncovered(left: number, top: number, width: number, height: number): boolean {
    const right = left + width - 1;
    const bottom = top + height - 1;
    return isClear(left + 1, top + 1) && isClear(right, top + 1) && isClear(left + 1, bottom) && isClear(right, bottom);
  }

  function isClear(x: number, y: number): boolean {
    const topmost = document.elementsFromPoint(x, y).find((hit) => !hit.closest('[data-type-right-badge], type-right-card'));
    return !topmost || element.contains(topmost);
  }

  let frame: number | undefined;
  function sync(): void {
    frame ??= requestAnimationFrame(place);
  }

  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  function fade(): void {
    badge.style.opacity = TYPING_OPACITY;
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => void (badge.style.opacity = IDLE_OPACITY), FADE_BACK_MS);
  }

  const listeners = new AbortController();
  const follow = { passive: true, signal: listeners.signal };
  document.addEventListener('scroll', sync, { ...follow, capture: true });
  window.addEventListener('resize', sync, follow);
  element.addEventListener('mousemove', sync, follow);
  element.addEventListener('focusin', sync, follow);
  element.addEventListener('input', fade, follow);
  const resizeObserver = new ResizeObserver(sync);
  resizeObserver.observe(element);

  return {
    setLlmHealth(health) {
      const { label, color, title } = badgeFor(health);
      badge.textContent = label;
      badge.title = title;
      badge.style.background = color;
      sync();
    },
    followMove: sync,
    destroy() {
      listeners.abort();
      resizeObserver.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(fadeTimer);
      badge.remove();
    },
  };
}
