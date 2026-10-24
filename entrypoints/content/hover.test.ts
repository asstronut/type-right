// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplyResult } from './fields/field';
import { HoverController, type HoverTarget } from './hover';
import type { SlipHit } from './underlines';
import { makeSlipId, type Slip } from '../../lib/slips';

const OPEN_MS = 300;
const CLOSE_MS = 250;
const FRAME_MS = 20;

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

/** The second line of a Slip wrapped over two. */
const LINE = new DOMRect(10, 66, 40, 16);
const WORDS = new DOMRect(10, 50, 40, 32);

function hitOn(slip: Slip): SlipHit {
  return { slip, rect: LINE };
}

function createTarget() {
  return {
    element: document.body,
    anchorOf: vi.fn((_slip: Slip): DOMRect | undefined => WORDS),
    textOf: vi.fn((slip: Slip) => `text of ${slip.id}`),
    canApply: () => true,
    apply: vi.fn(async (): Promise<ApplyResult> => 'accepted'),
    ignore: vi.fn(),
    addToDictionary: vi.fn(),
  } satisfies HoverTarget;
}

function cardIsOpen(): boolean {
  return document.querySelector<HTMLElement>('type-right-card')?.style.display === 'block';
}

function cardTop(): number {
  return parseFloat(document.querySelector<HTMLElement>('type-right-card')!.style.top);
}

const nextFrame = () => vi.advanceTimersByTimeAsync(FRAME_MS);

let hover: HoverController;
let cardRoot: ShadowRoot;

beforeEach(() => {
  vi.useFakeTimers();
  const attachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    cardRoot = attachShadow.call(this, init);
    return cardRoot;
  });
  hover = new HoverController();
});

afterEach(() => {
  hover.destroy();
  vi.restoreAllMocks();
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

  it('closes when asked to', async () => {
    const field = createTarget();
    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS);

    hover.close();

    expect(cardIsOpen()).toBe(false);
  });

  it('stays where it is while something else on the page scrolls', async () => {
    const field = createTarget();
    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    const top = cardTop();

    document.body.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    await nextFrame();

    expect(cardIsOpen()).toBe(true);
    expect(cardTop()).toBe(top);
  });

  it('follows its words as they scroll, keeping to the line it opened on, measuring them once per frame', async () => {
    const field = createTarget();
    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    const top = cardTop();
    field.anchorOf.mockClear();

    field.anchorOf.mockReturnValue(new DOMRect(WORDS.x, WORDS.y - 30, WORDS.width, WORDS.height));
    document.body.dispatchEvent(new Event('scroll'));
    document.body.dispatchEvent(new Event('scroll'));
    await nextFrame();

    expect(field.anchorOf).toHaveBeenCalledOnce();
    expect(cardTop()).toBe(top - 30);
  });

  it('closes once its words scroll out of what shows of the Field', async () => {
    const field = createTarget();
    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS);

    field.anchorOf.mockReturnValue(undefined);
    document.body.dispatchEvent(new Event('scroll'));
    await nextFrame();

    expect(cardIsOpen()).toBe(false);
  });

  it('ignores a scroll inside the card', async () => {
    const field = createTarget();
    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS);

    field.anchorOf.mockReturnValue(undefined);
    document.querySelector('type-right-card')!.dispatchEvent(new Event('scroll'));
    await nextFrame();

    expect(cardIsOpen()).toBe(true);
  });
});

describe('the Hover card after Apply', () => {
  async function applyOn(field: ReturnType<typeof createTarget>, result: ApplyResult) {
    field.apply.mockResolvedValue(result);
    hover.point(field, hitOn(spellingSlip('recieve')));
    await vi.advanceTimersByTimeAsync(OPEN_MS);
    cardRoot.querySelector<HTMLButtonElement>('.show-answer')!.click();
    cardRoot.querySelector<HTMLButtonElement>('button.apply')!.click();
    await vi.advanceTimersByTimeAsync(0);
  }

  it.each([
    ['unchanged', "This editor didn't take the fix. Retype it yourself."],
    ['changedWrongly', 'Apply went wrong here. Press Ctrl+Z to undo it.'],
  ] as const)('reopens on the same Slip with a note when the result is %s, with the answer shown and no Apply', async (result, note) => {
    const field = createTarget();

    await applyOn(field, result);

    expect(field.apply).toHaveBeenCalledWith(expect.objectContaining({ id: spellingSlip('recieve').id }), 'text of ' + spellingSlip('recieve').id, 'receive');
    expect(cardIsOpen()).toBe(true);
    expect(cardRoot.querySelector('.note')!.textContent).toBe(note);
    expect(cardRoot.querySelector('.suggestion')!.textContent).toBe('receive');
    expect(cardRoot.querySelector('.show-answer')).toBeNull();
    expect(cardRoot.querySelector('button.apply')).toBeNull();
    expect(cardRoot.querySelector('.explanation')!.textContent).toBe('Spelling mistake');
  });

  it.each(['accepted', 'inconclusive', 'stale'] as const)('stays closed when the result is %s', async (result) => {
    const field = createTarget();

    await applyOn(field, result);

    expect(cardIsOpen()).toBe(false);
  });
});
