// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { APPLY_VERDICT_MS } from './fields/field';
import { runPage, type PageStore } from './page';
import { installHighlights } from './test-highlights';
import { installStaticRange, textUnder } from './test-static-range';
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
const EDITOR_BOX = new DOMRect(0, 0, 300, 100);

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

function addEditor(html: string, attributes: Record<string, string> = {}): HTMLElement {
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  for (const [name, value] of Object.entries(attributes)) editor.setAttribute(name, value);
  editor.innerHTML = html;
  document.body.appendChild(editor);
  vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(EDITOR_BOX);
  return editor;
}

function focus(element: Element): void {
  element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

function underlinedText(): string[] {
  return underlinedRanges().map(textUnder);
}

function cardIsOpen(): boolean {
  return document.querySelector<HTMLElement>('type-right-card')?.style.display === 'block';
}

/** Rests the pointer on the Field's underline until the Hover card opens. */
async function openHoverCard(field: HTMLElement): Promise<void> {
  field.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20 }));
  await vi.advanceTimersByTimeAsync(FRAME_MS + HOVER_OPEN_MS);
}

let contexts: ContentScriptContext[] = [];
let removeHighlights: () => void;
/** The card's shadow root is closed to the page; the tests keep the roots that get attached. */
let cardRoots: ShadowRoot[];

function card(): ShadowRoot {
  return cardRoots.at(-1)!;
}

function offersApply(): boolean {
  card().querySelector<HTMLButtonElement>('.show-answer')?.click();
  return card().querySelector('button.apply') !== null;
}

beforeEach(() => {
  vi.useFakeTimers();
  cardRoots = [];
  const attachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const root = attachShadow.call(this, init);
    if (this.localName === 'type-right-card') cardRoots.push(root);
    return root;
  });
  removeHighlights = installHighlights();
  installStaticRange();
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
  Reflect.deleteProperty(document, 'execCommand');
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

  type Unused = [string, (field: HTMLTextAreaElement) => void, (field: HTMLTextAreaElement) => void];
  const UNUSED: Unused[] = [
    ['disabled', (field) => void (field.disabled = true), (field) => void (field.disabled = false)],
    ['read-only', (field) => void (field.readOnly = true), (field) => void (field.readOnly = false)],
    ['aria-hidden', (field) => field.setAttribute('aria-hidden', 'true'), (field) => field.removeAttribute('aria-hidden')],
    ['inert', (field) => field.setAttribute('inert', ''), (field) => field.removeAttribute('inert')],
    [
      'without a box',
      (field) => void vi.mocked(field.getBoundingClientRect).mockReturnValue(new DOMRect()),
      (field) => void vi.mocked(field.getBoundingClientRect).mockReturnValue(TEXTAREA_BOX),
    ],
  ];

  it.each(UNUSED)('sends nothing to LanguageTool until its first input when it is %s', async (_, makeUnused) => {
    const field = addFilledField(TEXT);
    makeUnused(field);
    const page = createPage();

    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    field.dispatchEvent(new FocusEvent('focus'));
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(page.worker.languageTool).not.toHaveBeenCalled();
    expect(underlinedRanges()).toEqual([]);

    type(field, `${TEXT} More.`);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.worker.languageTool).toHaveBeenCalledWith(`${TEXT} More.`);
  });

  it.each(UNUSED)('is checked once, on its first focus, after it was %s at the start', async (_, makeUnused, makeUsable) => {
    const field = addFilledField(TEXT);
    makeUnused(field);
    const page = createPage();
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);

    makeUsable(field);
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(page.worker.languageTool).not.toHaveBeenCalled();
    field.dispatchEvent(new FocusEvent('focus'));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    field.dispatchEvent(new FocusEvent('blur'));
    field.dispatchEvent(new FocusEvent('focus'));
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(page.worker.languageTool).toHaveBeenCalledOnce();
    expect(page.worker.languageTool).toHaveBeenCalledWith(TEXT);
    expect(underlinedRanges()).toHaveLength(1);
  });
});

describe('a Rich editor', () => {
  it('becomes a Field when it is focused, checks its text and underlines its Slips', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    const page = createPage();
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(typeRightElements()).toEqual([]);
    expect(page.worker.languageTool).not.toHaveBeenCalled();

    focus(editor);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(badges()).toHaveLength(1);
    expect(page.worker.languageTool).toHaveBeenCalledWith(TEXT);
    expect(underlinedText()).toEqual(['recieve']);
  });

  describe('with a signature after the typed text', () => {
    const SIGNATURE =
      '<div><br></div><span class="gmail_signature_prefix">-- </span><br><div class="gmail_signature"><div dir="ltr">Sender Name<br></div></div>';

    it('does not send the line being typed to the LLM or the Tally', async () => {
      const editor = addEditor(`<div>I recieve it</div>${SIGNATURE}`);
      const page = createPage();
      focus(editor);

      await vi.advanceTimersByTimeAsync(LLM_DEBOUNCE_MS + DEBOUNCE_MS);

      expect(page.worker.languageTool).toHaveBeenCalledWith('I recieve it');
      expect(page.worker.llm).not.toHaveBeenCalled();
      expect(page.worker.recordSlips).not.toHaveBeenCalled();
    });

    it('sends the line once a full stop finishes it', async () => {
      const editor = addEditor(`<div>I recieve it.</div>${SIGNATURE}`);
      const page = createPage();
      focus(editor);

      await vi.advanceTimersByTimeAsync(LLM_DEBOUNCE_MS + DEBOUNCE_MS);

      expect(page.worker.llm).toHaveBeenCalledWith('I recieve it.');
    });
  });

  it('counts a line followed by a code block at the end as a Finished sentence', async () => {
    const editor = addEditor('<div>I recieve it</div><pre>code</pre>');
    const page = createPage();
    focus(editor);

    await vi.advanceTimersByTimeAsync(LLM_DEBOUNCE_MS + DEBOUNCE_MS);

    expect(page.worker.llm).toHaveBeenCalledWith('I recieve it');
  });

  it('is one Field however often it is focused', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    const page = createPage();

    focus(editor);
    focus(editor);
    focus(editor.firstElementChild!);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(badges()).toHaveLength(1);
    expect(page.worker.languageTool).toHaveBeenCalledOnce();
  });

  it('is the outer editing host when an editable inside it is focused', async () => {
    const editor = addEditor('<p>Outer recieve.</p><div contenteditable="true"><p>Inner text.</p></div>');
    const page = createPage();

    focus(editor.querySelector('div > p')!);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    focus(editor);

    expect(badges()).toHaveLength(1);
    expect(page.worker.languageTool).toHaveBeenCalledOnce();
    expect(page.worker.languageTool).toHaveBeenCalledWith('Outer recieve.\nInner text.');
  });

  const inside = (className: string) => (editor: HTMLElement) => {
    const wrapper = document.createElement('div');
    wrapper.className = className;
    editor.before(wrapper);
    wrapper.append(editor);
  };

  it.each<[string, (editor: HTMLElement) => void]>([
    ['a combobox', (editor) => editor.setAttribute('role', 'combobox')],
    ['a searchbox', (editor) => editor.setAttribute('role', 'searchbox')],
    ['single-line by aria-multiline', (editor) => editor.setAttribute('aria-multiline', 'false')],
    ['aria-hidden', (editor) => editor.setAttribute('aria-hidden', 'true')],
    ['inert', (editor) => editor.setAttribute('inert', '')],
    ['without a box', (editor) => void vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect())],
    ['inside a CodeMirror editor', inside('cm-editor')],
    ['inside a Monaco editor', inside('monaco-editor')],
    ['inside an Ace editor', inside('ace_editor')],
  ])('is no Field when it is %s', async (_, makeUnfit) => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    makeUnfit(editor);
    const page = createPage();

    focus(editor);
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(typeRightElements()).toEqual([]);
    expect(underlinedRanges()).toEqual([]);
    expect(page.worker.languageTool).not.toHaveBeenCalled();
  });

  it('is judged again on its next focus when it was out of sight', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`, { 'aria-hidden': 'true' });
    const page = createPage();
    focus(editor);
    expect(badges()).toEqual([]);

    editor.removeAttribute('aria-hidden');
    focus(editor);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(badges()).toHaveLength(1);
    expect(page.worker.languageTool).toHaveBeenCalledWith(TEXT);
  });

  it('is a Field at once when it has focus before Type Right starts, and no other editor is', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    addEditor('<p>Other recieve.</p>');
    editor.focus();

    const page = createPage();

    expect(badges()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.worker.languageTool).toHaveBeenCalledOnce();
    expect(page.worker.languageTool).toHaveBeenCalledWith(TEXT);
  });

  it('is checked again when its text nodes are edited', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    const page = createPage();
    focus(editor);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    page.worker.languageTool.mockClear();

    editor.querySelector('p')!.firstChild!.textContent = 'Another recieve.';
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(page.worker.languageTool).toHaveBeenCalledWith('Another recieve.');
    expect(underlinedText()).toEqual(['recieve']);
  });

  it('draws its underlines again in the new nodes when the site re-renders the same text', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    const page = createPage();
    focus(editor);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const [before] = underlinedRanges();

    editor.querySelector('p')!.replaceChildren(document.createTextNode(TEXT));
    await vi.advanceTimersByTimeAsync(0);

    const after = underlinedRanges();
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before);
    expect(after[0]!.startContainer).toBe(editor.querySelector('p')!.firstChild);
    expect(underlinedText()).toEqual(['recieve']);
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(page.worker.languageTool).toHaveBeenCalledOnce();
  });

  it('keeps its Hover card open through a re-render of the same text, and closes it for new text', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    createPage();
    focus(editor);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await openHoverCard(editor);
    expect(cardIsOpen()).toBe(true);

    editor.querySelector('p')!.replaceChildren(document.createTextNode(TEXT));
    await vi.advanceTimersByTimeAsync(0);
    expect(cardIsOpen()).toBe(true);

    editor.querySelector('p')!.firstChild!.textContent = `${TEXT} More.`;
    await vi.advanceTimersByTimeAsync(0);
    expect(cardIsOpen()).toBe(false);
  });

  it('ends with its editor, leaving the others as they are', async () => {
    const leaving = addEditor(`<p>${TEXT}</p>`);
    const staying = addEditor('<p>Also recieve.</p>');
    const page = createPage();
    focus(leaving);
    focus(staying);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(badges()).toHaveLength(2);
    expect(underlinedRanges()).toHaveLength(2);
    leaving.querySelector('p')!.firstChild!.textContent = `${TEXT} Still recieve.`;
    await vi.advanceTimersByTimeAsync(0);
    vi.clearAllMocks();

    leaving.remove();
    await vi.advanceTimersByTimeAsync(0);

    expect(badges()).toHaveLength(1);
    expect(underlinedRanges()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LLM_DEBOUNCE_MS);
    expect(page.worker.languageTool).not.toHaveBeenCalled();

    staying.querySelector('p')!.firstChild!.textContent = 'Again recieve.';
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.worker.languageTool).toHaveBeenCalledWith('Again recieve.');
    expect(underlinedRanges()).toHaveLength(1);
  });

  it('stays with an editor that is moved within the page', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    const page = createPage();
    focus(editor);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const home = document.body.appendChild(document.createElement('div'));
    home.appendChild(editor);
    await vi.advanceTimersByTimeAsync(0);

    expect(badges()).toHaveLength(1);
    expect(underlinedRanges()).toHaveLength(1);
    editor.querySelector('p')!.firstChild!.textContent = `${TEXT} More.`;
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(page.worker.languageTool).toHaveBeenLastCalledWith(`${TEXT} More.`);
  });

  it('is a new Field when the site puts a rebuilt editor in its place', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    const page = createPage();
    focus(editor);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    editor.remove();
    const rebuilt = addEditor(`<p>${TEXT}</p>`);
    await vi.advanceTimersByTimeAsync(0);
    expect(typeRightElements()).toEqual([]);
    focus(rebuilt);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(badges()).toHaveLength(1);
    expect(underlinedText()).toEqual(['recieve']);
    expect(page.worker.languageTool).toHaveBeenCalledTimes(2);
  });

  it('is left alone once Type Right has left the page', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    const page = createPage();
    focus(editor);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    page.ctx.notifyInvalidated();
    expect(typeRightElements()).toEqual([]);
    vi.clearAllMocks();
    editor.querySelector('p')!.firstChild!.textContent = 'More recieve.';
    focus(addEditor(`<p>${TEXT}</p>`));
    await vi.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(typeRightElements()).toEqual([]);
    expect(page.worker.languageTool).not.toHaveBeenCalled();
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

describe('Apply after an editor refused a fix', () => {
  async function focusAndCheck(editor: HTMLElement): Promise<void> {
    focus(editor);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  }

  async function refuseAnApplyIn(editor: HTMLElement): Promise<void> {
    document.execCommand = vi.fn(() => true);
    await openHoverCard(editor);
    expect(offersApply()).toBe(true);
    card().querySelector<HTMLButtonElement>('button.apply')!.click();
    await vi.advanceTimersByTimeAsync(APPLY_VERDICT_MS + FRAME_MS);
  }

  it('is offered for a word in one text node of a Rich editor, and not for one split by formatting', async () => {
    const whole = addEditor(`<p>${TEXT}</p>`);
    const split = addEditor('<p>I rec<b>iev</b>e it.</p>');
    createPage();
    await focusAndCheck(whole);
    await focusAndCheck(split);

    await openHoverCard(whole);
    expect(offersApply()).toBe(true);
    await openHoverCard(split);
    expect(underlinedText()).toContain('recieve');
    expect(offersApply()).toBe(false);
  });

  it('is gone from every Rich editor on the page, a rebuilt one included, while textareas still offer it', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    const other = addEditor('<p>Also recieve.</p>');
    const textarea = addFilledField(TEXT);
    createPage();
    await focusAndCheck(editor);
    await focusAndCheck(other);

    await refuseAnApplyIn(editor);

    expect(cardIsOpen()).toBe(true);
    expect(card().querySelector('.note')!.textContent).toBe("This editor didn't take the fix. Retype it yourself.");
    expect(card().querySelector('button.apply')).toBeNull();
    await openHoverCard(other);
    expect(offersApply()).toBe(false);

    editor.remove();
    const rebuilt = addEditor(`<p>${TEXT}</p>`);
    await vi.advanceTimersByTimeAsync(0);
    await focusAndCheck(rebuilt);
    await openHoverCard(rebuilt);
    expect(offersApply()).toBe(false);

    type(textarea, TEXT);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await openHoverCard(textarea);
    expect(offersApply()).toBe(true);
  });

  it('is gone again after Type Right is turned off and on for the site', async () => {
    const editor = addEditor(`<p>${TEXT}</p>`);
    const page = createPage();
    await focusAndCheck(editor);
    await refuseAnApplyIn(editor);

    page.changeSettings({ disabledSites: [HOSTNAME] });
    page.changeSettings({ disabledSites: [] });
    await focusAndCheck(editor);
    await openHoverCard(editor);

    expect(offersApply()).toBe(false);
  });
});
