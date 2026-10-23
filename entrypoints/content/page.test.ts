// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { runPage, type PageStore } from './page';
import { installHighlights } from './test-highlights';
import type { LlmFailure } from '../../lib/engine';
import { DEFAULT_SETTINGS, type Settings } from '../../lib/settings';
import { EMPTY_TALLY, type SlipTally } from '../../lib/slip-tally';
import { makeSlipId, SLIP_KINDS, type Slip } from '../../lib/slips';

/**
 * WXT's `browser` is the global `chrome`, read once on import. A running
 * extension's runtime has an id; once the extension reloads, the orphaned
 * content script's runtime has none.
 */
const runtime = vi.hoisted(() => {
  const runtime: { id?: string } = { id: 'type-right' };
  (globalThis as { chrome?: unknown }).chrome = { runtime };
  return runtime;
});

const HOSTNAME = 'example.com';
const DEBOUNCE_MS = 600;
const LLM_DEBOUNCE_MS = 1500;
/** Longer than any wait the checker schedules, the LLM's longest retry included. */
const LONG_AFTER_MS = 10 * 60_000;
/** Longer than the Hover card's open delay. */
const HOVER_OPEN_MS = 300;
const FRAME_MS = 20;
const TEXT = 'I recieve it.';
const UNDERLINE_BOX = new DOMRect(10, 10, 40, 16);
const TEXTAREA_BOX = new DOMRect(0, 0, 200, 50);

const LLM_ON: Settings = { ...DEFAULT_SETTINGS, llmConsent: true, llmApiKey: 'test-key' };

/** What an extension API throws once the extension has reloaded. */
const invalidated = () => new Error('Extension context invalidated.');

function spellingSlip(text: string, word: string): Slip {
  const start = text.indexOf(word);
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

interface PageOptions {
  settings?: Settings;
  /** Every unsubscribe the extension hands out throws, as one may after a reload. */
  stopsThrow?: boolean;
}

/** The page's surroundings: Engines, storage and the LLM gate, each a fake the test can see into. */
function createPage({ settings = LLM_ON, stopsThrow = false }: PageOptions = {}) {
  const ctx = new ContentScriptContext('type-right');
  contexts.push(ctx);

  const settingsWatchers = new Set<(settings: Settings) => void>();
  const tallyWatchers = new Set<(tally: SlipTally) => void>();
  const failureWatchers = new Set<(failure: LlmFailure | undefined) => void>();
  function watch<T>(watchers: Set<T>, watcher: T): () => void {
    watchers.add(watcher);
    return () => {
      if (stopsThrow) throw invalidated();
      watchers.delete(watcher);
    };
  }

  const store: PageStore = {
    watchSettings: (onChange) => watch(settingsWatchers, onChange),
    watchTally: (onChange) => watch(tallyWatchers, onChange),
    addToDictionary: vi.fn(async () => undefined),
  };
  /** Everything that would send a message to the background worker. */
  const worker = {
    languageTool: vi.fn(async (text: string) => (text.includes('recieve') ? [spellingSlip(text, 'recieve')] : [])),
    // Never reaches the LLM, so the checker keeps retrying: 5 s, then doubling up to a minute.
    llm: vi.fn(async (): Promise<Slip[]> => {
      throw new Error('LLM check failed');
    }),
    currentFailure: vi.fn(async (): Promise<LlmFailure | undefined> => undefined),
    recordSlips: vi.fn(async () => undefined),
  };

  runPage({
    ctx,
    hostname: HOSTNAME,
    settings,
    store,
    engines: { languageTool: { check: worker.languageTool }, llm: { check: worker.llm } },
    llmFailure: {
      currentFailure: worker.currentFailure,
      onFailureChange: (onChange) => watch(failureWatchers, onChange),
    },
    recordSlips: worker.recordSlips,
  });

  return {
    ctx,
    worker,
    changeSettings(changes: Partial<Settings>) {
      settings = { ...settings, ...changes };
      settingsWatchers.forEach((watcher) => watcher(settings));
    },
    resetTally: () => tallyWatchers.forEach((watcher) => watcher(EMPTY_TALLY)),
    announceFailure: (failure: LlmFailure) => failureWatchers.forEach((watcher) => watcher(failure)),
    watcherCount: () => settingsWatchers.size + tallyWatchers.size + failureWatchers.size,
  };
}

function typeRightElements(): Element[] {
  return [...document.querySelectorAll('[data-type-right-badge], type-right-card')];
}

function badges(): Element[] {
  return [...document.querySelectorAll('[data-type-right-badge]')];
}

function underlinedRanges(): AbstractRange[] {
  return SLIP_KINDS.flatMap((kind) => [...(CSS.highlights.get(`type-right-${kind}`) ?? [])]);
}

function addField(): HTMLTextAreaElement {
  const field = document.createElement('textarea');
  document.body.appendChild(field);
  return field;
}

function addFilledField(text: string): HTMLTextAreaElement {
  const field = addField();
  field.value = text;
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(TEXTAREA_BOX);
  return field;
}

function type(field: HTMLTextAreaElement, text: string): void {
  field.value = text;
  field.dispatchEvent(new Event('input'));
}

/** Rests the pointer on the Field's underline until the Hover card opens. */
async function openHoverCard(field: HTMLTextAreaElement): Promise<void> {
  field.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20 }));
  await vi.advanceTimersByTimeAsync(FRAME_MS + HOVER_OPEN_MS);
}

let contexts: ContentScriptContext[] = [];
let removeHighlights: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  removeHighlights = installHighlights();
  Object.defineProperty(HTMLTextAreaElement.prototype, 'createValueRange', {
    configurable: true,
    value: (start: number, end: number) => ({
      startOffset: start,
      endOffset: end,
      disconnect: () => undefined,
      getClientRects: () => [UNDERLINE_BOX],
      getBoundingClientRect: () => UNDERLINE_BOX,
    }),
  });
});

afterEach(() => {
  contexts.forEach((ctx) => ctx.notifyInvalidated());
  contexts = [];
  runtime.id = 'type-right';
  document.body.replaceChildren();
  Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'createValueRange');
  removeHighlights();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('when the extension context is invalidated', () => {
  it('removes Type Right from the page and stops checking', async () => {
    const field = addField();
    const page = createPage();
    type(field, TEXT);
    await vi.advanceTimersByTimeAsync(LLM_DEBOUNCE_MS);
    expect(page.worker.languageTool).toHaveBeenCalled();
    expect(page.worker.llm).toHaveBeenCalled();
    await openHoverCard(field);
    // A Field added later is attached too.
    addField();
    await vi.advanceTimersByTimeAsync(0);
    expect(typeRightElements()).toHaveLength(3);
    expect(underlinedRanges()).toHaveLength(1);
    // A check is waiting to run, and the LLM to be retried.
    type(field, `${TEXT} More recieve.`);
    vi.clearAllMocks();

    page.ctx.notifyInvalidated();

    expect(typeRightElements()).toEqual([]);
    expect(underlinedRanges()).toEqual([]);
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    type(field, 'Another recieve.');
    addField();
    page.changeSettings({ dictionary: ['recieve'] });
    page.resetTally();
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(typeRightElements()).toEqual([]);
    expect(page.worker.languageTool).not.toHaveBeenCalled();
    expect(page.worker.llm).not.toHaveBeenCalled();
    expect(page.worker.currentFailure).not.toHaveBeenCalled();
    expect(page.worker.recordSlips).not.toHaveBeenCalled();
    expect(page.watcherCount()).toBe(0);
  });

  it('still removes it all when the extension throws on unsubscribing', async () => {
    const field = addField();
    const page = createPage({ stopsThrow: true });
    type(field, TEXT);
    await vi.advanceTimersByTimeAsync(LLM_DEBOUNCE_MS);
    await openHoverCard(field);
    type(field, `${TEXT} More recieve.`);
    vi.clearAllMocks();

    page.ctx.notifyInvalidated();

    expect(typeRightElements()).toEqual([]);
    expect(underlinedRanges()).toEqual([]);
    // The watchers it couldn't remove leave the page alone.
    page.changeSettings({ disabledSites: [HOSTNAME] });
    page.changeSettings({ disabledSites: [] });
    page.resetTally();
    page.announceFailure('quota');
    addField();
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(typeRightElements()).toEqual([]);
    expect(page.worker.languageTool).not.toHaveBeenCalled();
    expect(page.worker.llm).not.toHaveBeenCalled();
    expect(page.worker.currentFailure).not.toHaveBeenCalled();
    expect(page.worker.recordSlips).not.toHaveBeenCalled();
  });

  it('lets go of its watchers on a site that is turned off', async () => {
    addField();
    const page = createPage({ settings: { ...LLM_ON, disabledSites: [HOSTNAME] } });
    expect(typeRightElements()).toEqual([]);

    page.ctx.notifyInvalidated();

    expect(page.watcherCount()).toBe(0);
    page.changeSettings({ disabledSites: [] });
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(typeRightElements()).toEqual([]);
  });
});

describe('after the extension reloads', () => {
  it('notices on the next edit', async () => {
    const field = addField();
    const page = createPage();
    type(field, TEXT);
    await vi.advanceTimersByTimeAsync(LLM_DEBOUNCE_MS);
    vi.clearAllMocks();

    runtime.id = undefined;
    type(field, `${TEXT} More recieve.`);

    expect(typeRightElements()).toEqual([]);
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(page.worker.languageTool).not.toHaveBeenCalled();
    expect(page.worker.llm).not.toHaveBeenCalled();
    expect(page.watcherCount()).toBe(0);
  });

  it('notices when a check fails', async () => {
    const field = addField();
    const page = createPage();
    type(field, TEXT);
    page.worker.languageTool.mockRejectedValue(invalidated());

    runtime.id = undefined;
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(page.worker.languageTool).toHaveBeenCalledOnce();
    expect(typeRightElements()).toEqual([]);
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(page.worker.languageTool).toHaveBeenCalledOnce();
    expect(page.worker.llm).not.toHaveBeenCalled();
    expect(page.watcherCount()).toBe(0);
  });

  it('does not start on a page whose extension is already gone', () => {
    addField();
    runtime.id = undefined;

    const page = createPage();

    expect(typeRightElements()).toEqual([]);
    expect(page.watcherCount()).toBe(0);
  });
});

describe('a Field', () => {
  it('ends with its textarea, leaving the others as they are', async () => {
    const leaving = addField();
    const staying = addField();
    const page = createPage();
    type(leaving, TEXT);
    type(staying, 'Also recieve.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(badges()).toHaveLength(2);
    expect(underlinedRanges()).toHaveLength(2);
    type(leaving, `${TEXT} Still recieve.`);
    vi.clearAllMocks();

    leaving.remove();
    await vi.advanceTimersByTimeAsync(0);

    expect(badges()).toHaveLength(1);
    expect(underlinedRanges()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LLM_DEBOUNCE_MS);
    expect(page.worker.languageTool).not.toHaveBeenCalled();

    type(staying, 'Again recieve.');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.worker.languageTool).toHaveBeenCalledWith('Again recieve.');
    expect(underlinedRanges()).toHaveLength(1);
  });

  it('stays with a textarea that is moved within the page', async () => {
    const field = addField();
    const page = createPage();
    type(field, TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const home = document.createElement('div');
    document.body.appendChild(home);
    home.appendChild(field);
    await vi.advanceTimersByTimeAsync(0);

    expect(badges()).toHaveLength(1);
    expect(underlinedRanges()).toHaveLength(1);
    type(field, `${TEXT} More.`);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.worker.languageTool).toHaveBeenLastCalledWith(`${TEXT} More.`);
  });

  it('opens a Hover card for the Slip under the pointer', async () => {
    const field = addField();
    createPage();
    type(field, TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(document.querySelector('type-right-card')).toBeNull();

    await openHoverCard(field);

    expect(document.querySelector<HTMLElement>('type-right-card')?.style.display).toBe('block');
  });
});

describe('a textarea that already holds text', () => {
  it('is checked as soon as the page starts', async () => {
    addFilledField(TEXT);
    const page = createPage();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(page.worker.languageTool).toHaveBeenCalledWith(TEXT);
    expect(underlinedRanges()).toHaveLength(1);
  });

  it.each<[string, (field: HTMLTextAreaElement) => void]>([
    ['disabled', (field) => void (field.disabled = true)],
    ['read-only', (field) => void (field.readOnly = true)],
    ['aria-hidden', (field) => field.setAttribute('aria-hidden', 'true')],
    ['inert', (field) => field.setAttribute('inert', '')],
    ['without a box', (field) => void vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(new DOMRect())],
  ])('sends nothing to LanguageTool until its first input when it is %s', async (_, makeUnused) => {
    const field = addFilledField(TEXT);
    makeUnused(field);
    const page = createPage();

    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(page.worker.languageTool).not.toHaveBeenCalled();
    expect(underlinedRanges()).toEqual([]);

    type(field, `${TEXT} More.`);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.worker.languageTool).toHaveBeenCalledWith(`${TEXT} More.`);
  });
});

describe('the underlines when the extension goes away', () => {
  it("leave a highlight that isn't Type Right's in place, and take Type Right's", async () => {
    const field = addField();
    const page = createPage();
    type(field, TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(CSS.highlights.has('type-right-grammar')).toBe(true);
    const foreign = new Highlight();
    CSS.highlights.set('type-right-spelling', foreign);

    page.ctx.notifyInvalidated();

    expect(CSS.highlights.get('type-right-spelling')).toBe(foreign);
    expect(CSS.highlights.has('type-right-grammar')).toBe(false);
  });
});
