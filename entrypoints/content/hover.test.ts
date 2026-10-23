// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverController, type HoverTarget } from './hover';
import type { SlipHit } from './underlines';
import { makeSlipId, type Slip } from '../../lib/slips';

const OPEN_MS = 300;
const CLOSE_MS = 250;

function spellingSlip(word: string, start = 0): Slip {
  return {
    id: makeSlipId('spelling', word),
    start,
    end: start + word.length,
    kind: 'spelling',
    type: 'misspelling',
    explanation: 'Spelling mistake',
    suggestions: ['receive'],
    source: 'languagetool',
  };
}

function hitOn(slip: Slip): SlipHit {
  return { slip, rect: new DOMRect(10, 10, 40, 16) };
}

function createTarget() {
  return {
    textOf: vi.fn((slip: Slip) => `text of ${slip.id}`),
    canApply: () => true,
    apply: vi.fn(),
    ignore: vi.fn(),
    addToDictionary: vi.fn(),
  } satisfies HoverTarget;
}

function cardIsOpen(): boolean {
  return document.querySelector<HTMLElement>('type-right-card')?.style.display === 'block';
}

let hover: HoverController;

beforeEach(() => {
  vi.useFakeTimers();
  hover = new HoverController();
});

afterEach(() => {
  hover.destroy();
  vi.useRealTimers();
});

describe('the Hover card', () => {
  it('opens once the pointer has rested on an underline, not before', async () => {
    const field = createTarget();

    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS - 1);
    expect(cardIsOpen()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(cardIsOpen()).toBe(true);
  });

  it('never opens for a pointer that sweeps across underlines', async () => {
    const field = createTarget();

    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS - 1);
    hover.point(field, hitOn(spellingSlip('wich', 20)));
    await vi.advanceTimersByTimeAsync(OPEN_MS - 1);

    expect(cardIsOpen()).toBe(false);
  });

  it('closes after a grace period once the pointer leaves, unless it returns', async () => {
    const field = createTarget();
    const hit = hitOn(spellingSlip('recieve'));
    hover.point(field, hit);
    await vi.advanceTimersByTimeAsync(OPEN_MS);

    hover.point(field, undefined);
    await vi.advanceTimersByTimeAsync(CLOSE_MS - 1);
    hover.point(field, hit);
    await vi.advanceTimersByTimeAsync(CLOSE_MS);
    expect(cardIsOpen()).toBe(true);

    hover.point(field, undefined);
    await vi.advanceTimersByTimeAsync(CLOSE_MS);
    expect(cardIsOpen()).toBe(false);
  });

  it('stays open while the pointer is on it, even when its Field hears the pointer leave after that', async () => {
    const field = createTarget();
    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    const card = document.querySelector('type-right-card')!;

    card.dispatchEvent(new MouseEvent('mouseenter'));
    hover.point(field, undefined);
    await vi.advanceTimersByTimeAsync(CLOSE_MS);
    expect(cardIsOpen()).toBe(true);

    card.dispatchEvent(new MouseEvent('mouseleave'));
    await vi.advanceTimersByTimeAsync(CLOSE_MS);
    expect(cardIsOpen()).toBe(false);
  });

  it('closes only the card of the Field that changed', async () => {
    const [first, second] = [createTarget(), createTarget()];
    hover.point(second, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS);

    hover.closeFor(first);
    expect(cardIsOpen()).toBe(true);

    hover.closeFor(second);
    expect(cardIsOpen()).toBe(false);
  });

  it("doesn't open a card whose Field changed while the pointer rested", async () => {
    const field = createTarget();
    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS - 1);

    hover.closeFor(field);
    await vi.advanceTimersByTimeAsync(OPEN_MS);

    expect(cardIsOpen()).toBe(false);
  });

  it("keeps a Field's change from cancelling another Field's card about to open", async () => {
    const [first, second] = [createTarget(), createTarget()];
    hover.point(second, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS - 1);

    hover.closeFor(first);
    hover.point(first, undefined);
    await vi.advanceTimersByTimeAsync(1);

    expect(cardIsOpen()).toBe(true);
  });

  it('opens a card for each Field even when two have the same Slip', async () => {
    const [first, second] = [createTarget(), createTarget()];
    const slip = spellingSlip('recieve');
    hover.point(first, hitOn(slip));
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    expect(first.textOf).toHaveBeenCalledOnce();

    hover.point(second, hitOn(slip));
    await vi.advanceTimersByTimeAsync(OPEN_MS);

    expect(second.textOf).toHaveBeenCalledOnce();
    expect(cardIsOpen()).toBe(true);
  });

  it('closes when asked to, and when the page scrolls', async () => {
    const field = createTarget();
    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    hover.close();
    expect(cardIsOpen()).toBe(false);

    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    document.body.dispatchEvent(new Event('scroll'));
    expect(cardIsOpen()).toBe(false);
  });
});
