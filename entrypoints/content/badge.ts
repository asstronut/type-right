import type { LlmFailure } from '../../lib/engine';
import type { LlmHealth } from '../../lib/llm-health';

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

/** Keeps the badge clear of the textarea's resize grip in the bottom-right corner. */
const BADGE_INSET_PX = { right: 18, bottom: 4 };

export interface Badge {
  setLlmHealth(health: LlmHealth): void;
  followMove(): void;
  destroy(): void;
}

/**
 * Says in a corner of `element` whether the Field's text goes to the LLM;
 * hovering it tells why. It follows the element when the page scrolls or the
 * element is resized, and hides while the element is removed or has no box.
 */
export function createBadge(element: HTMLElement): Badge {
  const badge = document.createElement('div');
  badge.setAttribute('data-type-right-badge', '');
  Object.assign(badge.style, {
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
  document.documentElement.appendChild(badge);

  function place(): void {
    if (!badge.textContent) return;
    const rect = visibleBox(element);
    if (!element.isConnected || !rect) {
      badge.style.display = 'none';
      return;
    }
    badge.style.display = 'block';
    badge.style.left = `${rect.right - BADGE_INSET_PX.right - badge.offsetWidth}px`;
    badge.style.top = `${rect.bottom - BADGE_INSET_PX.bottom - badge.offsetHeight}px`;
  }

  const listeners = new AbortController();
  const follow = { passive: true, signal: listeners.signal };
  document.addEventListener('scroll', place, { ...follow, capture: true });
  window.addEventListener('resize', place, follow);
  const resizeObserver = new ResizeObserver(place);
  resizeObserver.observe(element);

  return {
    setLlmHealth(health) {
      const { label, color, title } = badgeFor(health);
      badge.textContent = label;
      badge.title = title;
      badge.style.background = color;
      place();
    },
    followMove: place,
    destroy() {
      listeners.abort();
      resizeObserver.disconnect();
      badge.remove();
    },
  };
}

const CLIPPING = new Set(['hidden', 'clip', 'scroll', 'auto']);

function visibleBox(element: HTMLElement): DOMRect | undefined {
  let { left, top, right, bottom } = element.getBoundingClientRect();
  if (right <= left || bottom <= top) return undefined;
  for (let inner: HTMLElement = element, ancestor = element.parentElement; ancestor; inner = ancestor, ancestor = ancestor.parentElement) {
    if (ancestor === document.body || ancestor === document.documentElement) break;
    if (getComputedStyle(inner).position === 'fixed') break;
    const { overflowX, overflowY } = getComputedStyle(ancestor);
    if (!CLIPPING.has(overflowX) && !CLIPPING.has(overflowY)) continue;
    const clip = ancestor.getBoundingClientRect();
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  left = Math.max(left, 0);
  top = Math.max(top, 0);
  right = Math.min(right, window.innerWidth);
  bottom = Math.min(bottom, window.innerHeight);
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : undefined;
}
