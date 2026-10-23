// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBadge } from './badge';

const BOX = new DOMRect(100, 200, 300, 80);
const BADGE_WIDTH = 30;
const BADGE_HEIGHT = 14;

function badgeElement(): HTMLElement {
  const badge = document.querySelector<HTMLElement>('[data-type-right-badge]');
  if (!badge) throw new Error('no badge on the page');
  return badge;
}

function elementWith(box: DOMRect): { element: HTMLElement; moveTo(next: DOMRect): void } {
  const element = document.body.appendChild(document.createElement('textarea'));
  const measure = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(box);
  return { element, moveTo: (next) => void measure.mockReturnValue(next) };
}

afterEach(() => {
  document.body.replaceChildren();
  document.querySelectorAll('[data-type-right-badge]').forEach((badge) => badge.remove());
  vi.restoreAllMocks();
});

describe('the LLM badge', () => {
  it('says what the LLM health is, and why when asked', () => {
    const badge = createBadge(elementWith(BOX).element);

    badge.setLlmHealth({ state: 'active' });
    expect(badgeElement().textContent).toBe('LLM');

    badge.setLlmHealth({ state: 'lt-only', reason: 'excluded-site' });
    expect(badgeElement().textContent).toBe('LT only');
    expect(badgeElement().title).toContain('excluded');

    badge.setLlmHealth({ state: 'failing', reason: 'quota' });
    expect(badgeElement().textContent).toBe('LLM');
    expect(badgeElement().title).toContain('quota');
  });

  it("sits inside the element's bottom-right corner, clear of the resize grip", () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(BADGE_WIDTH);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(BADGE_HEIGHT);
    const badge = createBadge(elementWith(BOX).element);

    badge.setLlmHealth({ state: 'active' });

    expect(badgeElement().style.display).toBe('block');
    expect(badgeElement().style.left).toBe(`${BOX.right - 18 - BADGE_WIDTH}px`);
    expect(badgeElement().style.top).toBe(`${BOX.bottom - 4 - BADGE_HEIGHT}px`);
  });

  it('follows the element as the page scrolls or resizes', () => {
    const { element, moveTo } = elementWith(BOX);
    createBadge(element).setLlmHealth({ state: 'active' });
    const before = badgeElement().style.top;

    moveTo(new DOMRect(BOX.x, BOX.y - 50, BOX.width, BOX.height));
    element.parentElement?.dispatchEvent(new Event('scroll'));
    const afterScroll = badgeElement().style.top;
    moveTo(new DOMRect(BOX.x, BOX.y - 90, BOX.width, BOX.height));
    window.dispatchEvent(new Event('resize'));

    expect(afterScroll).not.toBe(before);
    expect(badgeElement().style.top).not.toBe(afterScroll);
  });

  it('is hidden while the element has no box or has left the page', () => {
    const { element, moveTo } = elementWith(new DOMRect());
    createBadge(element).setLlmHealth({ state: 'active' });
    expect(badgeElement().style.display).toBe('none');

    moveTo(BOX);
    window.dispatchEvent(new Event('resize'));
    expect(badgeElement().style.display).toBe('block');

    element.remove();
    window.dispatchEvent(new Event('resize'));
    expect(badgeElement().style.display).toBe('none');
  });

  it('leaves the page and stops following when destroyed', () => {
    const { element } = elementWith(BOX);
    const badge = createBadge(element);
    badge.setLlmHealth({ state: 'active' });
    const measure = vi.mocked(element.getBoundingClientRect);
    measure.mockClear();

    badge.destroy();
    window.dispatchEvent(new Event('resize'));
    element.dispatchEvent(new Event('scroll'));

    expect(document.querySelector('[data-type-right-badge]')).toBeNull();
    expect(measure).not.toHaveBeenCalled();
  });
});
