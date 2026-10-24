// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBadge } from './badge';

const BOX = new DOMRect(100, 200, 300, 80);
const BADGE_WIDTH = 30;
const BADGE_HEIGHT = 14;
const FRAME_MS = 20;
const FADE_BACK_MS = 1500;

function badgeElement(): HTMLElement {
  const badge = document.querySelector<HTMLElement>('[data-type-right-badge]');
  if (!badge) throw new Error('no badge on the page');
  return badge;
}

function isShown(): boolean {
  return badgeElement().style.display === 'block';
}

function elementWith(box: DOMRect, tag: 'textarea' | 'div' = 'textarea'): { element: HTMLElement; moveTo(next: DOMRect): void } {
  const element = document.body.appendChild(document.createElement(tag));
  const measure = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(box);
  return { element, moveTo: (next) => void measure.mockReturnValue(next) };
}

/** Has `cover` sit over the page below `top`, and the element above it. */
function coverBelow(element: HTMLElement, top: number): HTMLElement {
  const cover = document.body.appendChild(document.createElement('footer'));
  vi.spyOn(document, 'elementsFromPoint').mockImplementation((_x, y) => [badgeElement(), y >= top ? cover : element]);
  return cover;
}

const nextFrame = () => vi.advanceTimersByTimeAsync(FRAME_MS);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(BADGE_WIDTH);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(BADGE_HEIGHT);
});

afterEach(() => {
  document.body.replaceChildren();
  document.querySelectorAll('[data-type-right-badge]').forEach((badge) => badge.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
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

  it.each([
    ['a textarea', 'textarea', 18],
    ['a Rich editor', 'div', 4],
  ] as const)("sits inside the bottom-right corner of %s, clear of a textarea's resize grip", async (_kind, tag, right) => {
    createBadge(elementWith(BOX, tag).element).setLlmHealth({ state: 'active' });
    await nextFrame();

    expect(isShown()).toBe(true);
    expect(badgeElement().style.left).toBe(`${BOX.right - right - BADGE_WIDTH}px`);
    expect(badgeElement().style.top).toBe(`${BOX.bottom - 4 - BADGE_HEIGHT}px`);
  });

  it('sits in the corner of the part a scrolling container shows, when the element is taller than it', async () => {
    const scroller = document.body.appendChild(document.createElement('div'));
    scroller.style.overflowY = 'auto';
    const shown = new DOMRect(100, 200, 300, 40);
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(shown);
    const { element } = elementWith(new DOMRect(100, 200, 300, 400));
    scroller.appendChild(element);

    createBadge(element).setLlmHealth({ state: 'active' });
    await nextFrame();

    expect(badgeElement().style.top).toBe(`${shown.bottom - 4 - BADGE_HEIGHT}px`);
  });

  it('moves up the right edge, one badge height at a time, while site UI covers its spot', async () => {
    const { element } = elementWith(BOX);
    coverBelow(element, BOX.bottom - 30);

    createBadge(element).setLlmHealth({ state: 'active' });
    await nextFrame();

    expect(isShown()).toBe(true);
    expect(badgeElement().style.top).toBe(`${BOX.bottom - 4 - 3 * BADGE_HEIGHT}px`);
  });

  it('moves up when site UI covers only the bottom edge of its spot', async () => {
    const { element } = elementWith(BOX);
    coverBelow(element, BOX.bottom - 6);

    createBadge(element).setLlmHealth({ state: 'active' });
    await nextFrame();

    expect(badgeElement().style.top).toBe(`${BOX.bottom - 4 - 2 * BADGE_HEIGHT}px`);
  });

  it('hides when site UI covers every spot up the right edge', async () => {
    const { element } = elementWith(BOX);
    coverBelow(element, BOX.top);

    createBadge(element).setLlmHealth({ state: 'active' });
    await nextFrame();

    expect(isShown()).toBe(false);
  });

  it('follows the element as the page scrolls or resizes, once per frame', async () => {
    const { element, moveTo } = elementWith(BOX);
    createBadge(element).setLlmHealth({ state: 'active' });
    await nextFrame();
    const before = badgeElement().style.top;

    moveTo(new DOMRect(BOX.x, BOX.y - 50, BOX.width, BOX.height));
    element.parentElement?.dispatchEvent(new Event('scroll'));
    await nextFrame();
    const afterScroll = badgeElement().style.top;
    moveTo(new DOMRect(BOX.x, BOX.y - 90, BOX.width, BOX.height));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    const measure = vi.mocked(element.getBoundingClientRect);
    measure.mockClear();
    await nextFrame();

    expect(afterScroll).not.toBe(before);
    expect(badgeElement().style.top).not.toBe(afterScroll);
    expect(measure).toHaveBeenCalledOnce();
  });

  it('is hidden while nothing of the element shows or it has left the page', async () => {
    const { element, moveTo } = elementWith(new DOMRect());
    createBadge(element).setLlmHealth({ state: 'active' });
    await nextFrame();
    expect(isShown()).toBe(false);

    moveTo(BOX);
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    expect(isShown()).toBe(true);

    moveTo(new DOMRect(BOX.x, -200, BOX.width, BOX.height));
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    expect(isShown()).toBe(false);

    moveTo(BOX);
    element.remove();
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    expect(isShown()).toBe(false);
  });

  it.each([
    ['the hidden attribute', (element: HTMLElement) => void (element.hidden = true)],
    ['display: none', (element: HTMLElement) => void (element.style.display = 'none')],
  ])('is hidden on a textarea hidden by %s', async (_how, hide) => {
    const { element } = elementWith(BOX);
    hide(element);

    createBadge(element).setLlmHealth({ state: 'active' });
    await nextFrame();

    expect(isShown()).toBe(false);
  });

  it('fades while the user types, and comes back once they stop', async () => {
    const { element } = elementWith(BOX);
    createBadge(element).setLlmHealth({ state: 'active' });
    await nextFrame();
    const idle = Number(badgeElement().style.opacity);

    element.dispatchEvent(new Event('input'));
    expect(Number(badgeElement().style.opacity)).toBeLessThanOrEqual(0.25);
    await vi.advanceTimersByTimeAsync(FADE_BACK_MS - 100);
    element.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(FADE_BACK_MS - 1);
    expect(Number(badgeElement().style.opacity)).toBeLessThanOrEqual(0.25);

    await vi.advanceTimersByTimeAsync(1);
    expect(Number(badgeElement().style.opacity)).toBe(idle);
  });

  it('leaves the page and stops following when destroyed', async () => {
    const { element } = elementWith(BOX);
    const badge = createBadge(element);
    badge.setLlmHealth({ state: 'active' });
    await nextFrame();
    const measure = vi.mocked(element.getBoundingClientRect);
    measure.mockClear();

    window.dispatchEvent(new Event('resize'));
    badge.destroy();
    element.dispatchEvent(new Event('scroll'));
    await nextFrame();

    expect(document.querySelector('[data-type-right-badge]')).toBeNull();
    expect(measure).not.toHaveBeenCalled();
  });
});
