// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createField, type FieldAdapter, type FieldRead } from './field';
import type { HoverTarget } from '../hover';
import type { DrawnSlip, SlipHit, Underlines } from '../underlines';
import { createTestLlmWiring } from '../../../lib/llm-test-wiring';
import { DEFAULT_SETTINGS, type Settings } from '../../../lib/settings';
import { makeSlipId, type Slip } from '../../../lib/slips';

const HOSTNAME = 'example.com';
const DEBOUNCE_MS = 600;
const FRAME_MS = 20;
const TEXT = 'I recieve it.';
const BOX = new DOMRect(10, 10, 40, 16);

function spellingSlip(text: string, word: string): Slip {
  const start = text.indexOf(word);
  return {
    id: makeSlipId('spelling', word),
    start,
    end: start + word.length,
    kind: 'spelling',
    type: 'misspelling',
    explanation: 'Spelling mistake',
    suggestions: [],
    source: 'languagetool',
  };
}

async function checkSpelling(text: string): Promise<Slip[]> {
  return ['recieve', 'wich'].filter((word) => text.includes(word)).map((word) => spellingSlip(text, word));
}

function createFakeAdapter() {
  const element = document.body.appendChild(document.createElement('div'));
  let onRead: ((read: FieldRead) => void) | undefined;
  const replace = vi.fn(async (_slip: Slip, _suggestion: string) => undefined);
  const adapter: FieldAdapter = {
    element,
    watch: (callback) => void (onRead = callback),
    canApply: () => true,
    replace,
  };
  return {
    adapter,
    element,
    replace,
    deliver(text: string) {
      onRead?.({
        text,
        neverFlag: [],
        composing: false,
        rangeFor: (span) => ({ startOffset: span.start, endOffset: span.end }) as unknown as AbstractRange,
      });
    },
  };
}

function createFakeUnderlines() {
  const drawn = new Map<object, DrawnSlip[]>();
  let hit: SlipHit | undefined;
  const hitAt = vi.fn((_owner: object, _x: number, _y: number) => hit);
  const underlines: Underlines = {
    draw: (owner, next) => void drawn.set(owner, next),
    hitAt,
    forget: (owner) => void drawn.delete(owner),
    dispose: () => drawn.clear(),
  };
  return {
    underlines,
    hitAt,
    drawn: () => [...drawn.values()][0],
    pointerRestsOn(next: SlipHit | undefined) {
      hit = next;
    },
  };
}

function setup({ settings = DEFAULT_SETTINGS }: { settings?: Settings } = {}) {
  const fake = createFakeAdapter();
  const underlinesFake = createFakeUnderlines();
  const hover = {
    point: vi.fn<(target: HoverTarget, hit: SlipHit | undefined) => void>(),
    changed: vi.fn<(target: HoverTarget) => void>(),
    close: vi.fn<() => void>(),
  };
  const languageTool = vi.fn(checkSpelling);
  const addToDictionary = vi.fn();
  let siteSettings = settings;
  let reloaded = false;
  const field = createField(fake.adapter, {
    engines: { languageTool: { check: languageTool } },
    site: { hostname: HOSTNAME, settings: () => siteSettings },
    llmHealth: createTestLlmWiring().openPage(HOSTNAME),
    underlines: underlinesFake.underlines,
    hover,
    addToDictionary,
    onSlipsSeen: vi.fn(),
    noticeReload: () => reloaded,
  });

  return {
    ...fake,
    ...underlinesFake,
    field,
    hover,
    languageTool,
    addToDictionary,
    changeSettings: (changes: Partial<Settings>) => void (siteSettings = { ...siteSettings, ...changes }),
    reload: () => void (reloaded = true),
    underlined(text: string) {
      return this.drawn()?.map(({ range }) => text.slice(range.startOffset, range.endOffset));
    },
    hoverTarget(): HoverTarget {
      const call = hover.point.mock.calls.at(-1);
      if (!call) throw new Error('the hover was never told of the pointer');
      return call[0];
    },
    async pointAt(slip: Slip) {
      underlinesFake.pointerRestsOn({ slip, rect: BOX });
      fake.element.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20 }));
      await vi.advanceTimersByTimeAsync(FRAME_MS);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.body.replaceChildren();
  document.querySelectorAll('[data-type-right-badge]').forEach((badge) => badge.remove());
  vi.useRealTimers();
});

describe('checking what is read', () => {
  it('checks a read after the pause and underlines the flagged word', async () => {
    const page = setup();

    page.deliver(TEXT);
    expect(page.underlined(TEXT)).toEqual([]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(page.languageTool).toHaveBeenCalledWith(TEXT);
    expect(page.underlined(TEXT)).toEqual(['recieve']);
  });

  it('moves the underlines with a newer read at once, without waiting for the check', async () => {
    const page = setup();
    page.deliver(TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    page.languageTool.mockClear();

    const shifted = `Oh no. ${TEXT}`;
    page.deliver(shifted);
    expect(page.underlined(shifted)).toEqual(['recieve']);

    const fixed = 'Oh no. I receive it.';
    page.deliver(fixed);
    expect(page.underlined(fixed)).toEqual([]);
    expect(page.languageTool).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.languageTool).toHaveBeenCalled();
  });

  it('drops a read once the extension has reloaded', async () => {
    const page = setup();
    page.reload();

    page.deliver(TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(page.languageTool).not.toHaveBeenCalled();
    expect(page.drawn()).toBeUndefined();
  });

  it('underlines again without the Dictionary words after a Settings change', async () => {
    const page = setup();
    page.deliver('I recieve wich.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.underlined('I recieve wich.')).toEqual(['recieve', 'wich']);

    page.changeSettings({ dictionary: ['wich'] });
    page.field.refresh();

    expect(page.underlined('I recieve wich.')).toEqual(['recieve']);
  });
});

describe('Ignore here', () => {
  it('removes that Slip underline, keeps the others and stays ignored after the next check', async () => {
    const page = setup();
    const text = 'I recieve it and wich one.';
    page.deliver(text);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const recieve = page.drawn()!.find(({ range }) => text.slice(range.startOffset, range.endOffset) === 'recieve')!.slip;
    await page.pointAt(recieve);

    page.hoverTarget().ignore(recieve);

    expect(page.underlined(text)).toEqual(['wich']);

    const edited = 'I recieve it and wich one!';
    page.deliver(edited);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.languageTool).toHaveBeenLastCalledWith(edited);
    expect(page.underlined(edited)).toEqual(['wich']);
  });
});

describe('the Hover card', () => {
  it('hears of the pointer once per frame, from the latest position', async () => {
    const page = setup();
    page.deliver(TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    for (const clientX of [20, 25, 30]) {
      page.element.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY: 40 }));
    }
    await vi.advanceTimersByTimeAsync(FRAME_MS);

    expect(page.hitAt).toHaveBeenCalledOnce();
    expect(page.hitAt).toHaveBeenCalledWith(page.field, 30, 40);
  });

  it('hears of the pointer leaving, and not of a position it left behind', async () => {
    const page = setup();
    page.deliver(TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    page.element.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20 }));
    page.element.dispatchEvent(new MouseEvent('mouseleave'));
    await vi.advanceTimersByTimeAsync(FRAME_MS);

    expect(page.hitAt).not.toHaveBeenCalled();
    expect(page.hover.point).toHaveBeenCalledOnce();
    expect(page.hover.point.mock.calls[0]![1]).toBeUndefined();
  });

  it('closes on Escape, and when the Field changes or goes away', async () => {
    const page = setup();
    page.deliver(TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await page.pointAt(page.drawn()![0]!.slip);
    const target = page.hoverTarget();

    page.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(page.hover.close).not.toHaveBeenCalled();
    page.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(page.hover.close).toHaveBeenCalledOnce();

    page.deliver(`${TEXT} More.`);
    expect(page.hover.changed).toHaveBeenCalledWith(target);
    page.hover.changed.mockClear();
    page.field.dispose();
    expect(page.hover.changed).toHaveBeenCalledWith(target);
  });

  it('applies a fix only to the words the card was opened on', async () => {
    const page = setup();
    page.deliver(TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const slip = page.drawn()![0]!.slip;
    await page.pointAt(slip);
    const target = page.hoverTarget();
    const flagged = target.textOf(slip);
    expect(flagged).toBe('recieve');

    target.apply(slip, flagged, 'receive');
    expect(page.replace).toHaveBeenCalledWith(slip, 'receive');

    page.replace.mockClear();
    page.deliver(`Oh no. ${TEXT}`);
    target.apply(slip, flagged, 'receive');
    expect(page.replace).not.toHaveBeenCalled();
  });

  it('adds a word to the Dictionary', async () => {
    const page = setup();
    page.deliver(TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await page.pointAt(page.drawn()![0]!.slip);

    page.hoverTarget().addToDictionary('recieve');

    expect(page.addToDictionary).toHaveBeenCalledWith('recieve');
  });
});

describe('leaving the page', () => {
  it('takes away its underlines, badge and pending checks, and ignores what is read after', async () => {
    const page = setup();
    page.deliver(TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(document.querySelector('[data-type-right-badge]')).not.toBeNull();
    page.deliver(`${TEXT} More recieve.`);
    page.languageTool.mockClear();

    page.field.dispose();

    expect(page.drawn()).toBeUndefined();
    expect(document.querySelector('[data-type-right-badge]')).toBeNull();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.languageTool).not.toHaveBeenCalled();
    expect(page.drawn()).toBeUndefined();
  });
});
