// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldRead } from './field';
import { editingHostOf, richEditorAdapter } from './rich-editor';
import { installStaticRange, textUnder } from '../test-static-range';
import { makeSlipId, type Slip } from '../../../lib/slips';

const SLIP: Slip = {
  id: makeSlipId('spelling', 'recieve'),
  start: 2,
  end: 9,
  kind: 'spelling',
  type: 'misspelling',
  explanation: 'Spelling mistake',
  suggestions: ['receive'],
  source: 'languagetool',
};

function addEditable(html: string, contenteditable = 'true'): HTMLElement {
  const element = document.body.appendChild(document.createElement('div'));
  element.setAttribute('contenteditable', contenteditable);
  element.innerHTML = html;
  return element;
}

/** happy-dom's InputEvent drops `targetRanges`. */
function installTargetRanges(): void {
  const Base = InputEvent;
  vi.stubGlobal(
    'InputEvent',
    class extends Base {
      private readonly ranges: StaticRange[];
      constructor(type: string, init?: InputEventInit & { targetRanges?: StaticRange[] }) {
        super(type, init);
        this.ranges = init?.targetRanges ?? [];
      }
      override getTargetRanges(): StaticRange[] {
        return this.ranges;
      }
    },
  );
}

const nextBatch =() => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  installStaticRange();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('the editing host of a target', () => {
  it('is the outermost editable element, as an editable inside a host belongs to it', () => {
    const outer = addEditable('<p>Outer</p><div contenteditable="true"><p id="inner">Inner</p></div>');

    expect(editingHostOf(outer)).toBe(outer);
    expect(editingHostOf(outer.querySelector('#inner'))).toBe(outer);
    expect(editingHostOf(outer.querySelector('[contenteditable]'))).toBe(outer);
  });

  it('is the host of a plaintext-only editor too', () => {
    const editor = addEditable('<span>text</span>', 'plaintext-only');

    expect(editingHostOf(editor.firstElementChild)).toBe(editor);
  });

  it('is nothing for what is not editable, a textarea, or no target', () => {
    const page = document.body.appendChild(document.createElement('div'));
    const textarea = page.appendChild(document.createElement('textarea'));
    const editor = addEditable('<textarea></textarea>');

    expect(editingHostOf(page)).toBeNull();
    expect(editingHostOf(textarea)).toBeNull();
    expect(editingHostOf(editor.querySelector('textarea'))).toBeNull();
    expect(editingHostOf(document)).toBeNull();
    expect(editingHostOf(null)).toBeNull();
  });
});

describe('a Rich editor adapter', () => {
  let reads: FieldRead[];
  let listening: AbortController;

  beforeEach(() => {
    reads = [];
    listening = new AbortController();
  });

  afterEach(() => {
    listening.abort();
  });

  function watch(host: HTMLElement): void {
    richEditorAdapter(host, () => false).watch((read) => reads.push(read), listening.signal);
  }

  it('delivers the text at once, even before anything changes', () => {
    watch(addEditable('<p>I recieve it.</p>'));

    expect(reads.map(({ text }) => text)).toEqual(['I recieve it.']);
    expect(reads[0]!.composing).toBe(false);
    expect(reads[0]!.neverFlag).toEqual([]);
  });

  it('delivers one read per batch of changes, of the text as it is after them', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    watch(host);
    reads.length = 0;

    host.firstElementChild!.firstChild!.textContent = 'I recieve';
    host.appendChild(document.createElement('p')).textContent = 'More.';
    host.firstElementChild!.append(' it.');
    await nextBatch();

    expect(reads.map(({ text }) => text)).toEqual(['I recieve it.\nMore.']);
  });

  it('reads again when only the nodes changed and the text is the same, with ranges in the new nodes', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    watch(host);
    const before = reads.at(-1)!.rangeFor(SLIP);
    reads.length = 0;

    host.firstElementChild!.replaceChildren(document.createTextNode('I recieve it.'));
    await nextBatch();

    expect(reads).toHaveLength(1);
    const after = reads[0]!.rangeFor(SLIP);
    expect(reads[0]!.text).toBe('I recieve it.');
    expect(after.startContainer).not.toBe(before.startContainer);
    expect(after.startContainer).toBe(host.firstElementChild!.firstChild);
    expect(textUnder(after)).toBe('recieve');
  });

  it('reads composing from compositionstart on, and reports once with composing false at compositionend, even with no mutation after', async () => {
    const host = addEditable('<p>Hi </p>');
    watch(host);
    reads.length = 0;

    host.dispatchEvent(new CompositionEvent('compositionstart'));
    host.firstElementChild!.firstChild!.textContent = 'Hi nihao';
    await nextBatch();
    host.dispatchEvent(new CompositionEvent('compositionend', { data: 'nihao' }));
    await nextBatch();

    expect(reads.map(({ text, composing }) => [text, composing])).toEqual([
      ['Hi nihao', true],
      ['Hi nihao', false],
    ]);
  });

  it('is not told of attribute changes', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    watch(host);
    reads.length = 0;

    host.setAttribute('aria-label', 'Message');
    host.firstElementChild!.className = 'bold';
    await nextBatch();

    expect(reads).toEqual([]);
  });

  it('stops delivering once its signal aborts', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    watch(host);
    reads.length = 0;

    listening.abort();
    host.firstElementChild!.firstChild!.textContent = 'Another.';
    await nextBatch();

    expect(reads).toEqual([]);
  });

});

describe('Apply in a Rich editor', () => {
  let listening: AbortController;
  let refused: boolean;
  let execCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    listening = new AbortController();
    refused = false;
    execCommand = vi.fn(() => true);
    installTargetRanges();
    document.execCommand = execCommand as unknown as typeof document.execCommand;
  });

  afterEach(() => {
    listening.abort();
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'execCommand');
  });

  function adapterOn(host: HTMLElement) {
    const adapter = richEditorAdapter(host, () => refused);
    adapter.watch(() => undefined, listening.signal);
    return adapter;
  }

  async function replace(adapter: ReturnType<typeof adapterOn>, flagged = 'recieve') {
    const outcome = adapter.replace(SLIP, flagged, 'receive');
    await vi.advanceTimersByTimeAsync(50);
    return outcome;
  }

  function beforeInputsOn(host: HTMLElement, claim = false): InputEvent[] {
    const seen: InputEvent[] = [];
    host.addEventListener('beforeinput', (event) => {
      seen.push(event as InputEvent);
      if (claim) event.preventDefault();
    });
    return seen;
  }

  describe('canApply', () => {
    it('is true for a word inside one text node', () => {
      expect(adapterOn(addEditable('<p>I recieve it.</p>')).canApply(SLIP)).toBe(true);
    });

    it('is false when formatting splits the word across text nodes', () => {
      expect(adapterOn(addEditable('<p>I rec<b>iev</b>e it.</p>')).canApply(SLIP)).toBe(false);
    });

    it('is false once the page learned that an editor refuses fixes', () => {
      const adapter = adapterOn(addEditable('<p>I recieve it.</p>'));
      refused = true;

      expect(adapter.canApply(SLIP)).toBe(false);
    });

    it('is false when the host is not editable', () => {
      const host = addEditable('<p>I recieve it.</p>');
      const adapter = adapterOn(host);
      host.setAttribute('contenteditable', 'false');

      expect(adapter.canApply(SLIP)).toBe(false);
    });
  });

  it('is stale, and does nothing, when the live text moved on', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    const adapter = adapterOn(host);
    const events = beforeInputsOn(host);
    host.firstElementChild!.firstChild!.textContent = 'Nothing here.';

    expect(await replace(adapter)).toBe('stale');
    expect(events).toEqual([]);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('is stale before it watches anything', async () => {
    const adapter = richEditorAdapter(addEditable('<p>I recieve it.</p>'), () => false);

    expect(await replace(adapter)).toBe('stale');
  });

  it('is stale when formatting splits the word', async () => {
    const adapter = adapterOn(addEditable('<p>I rec<b>iev</b>e it.</p>'));

    expect(await replace(adapter)).toBe('stale');
  });

  it('selects the word, focuses the editor and dispatches beforeinput with the fix and where it goes', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    const adapter = adapterOn(host);
    const events = beforeInputsOn(host);

    expect(await replace(adapter)).toBe('attempted');

    expect(document.activeElement).toBe(host);
    expect(document.getSelection()!.toString()).toBe('recieve');
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event!.inputType).toBe('insertReplacementText');
    expect(event!.data).toBe('receive');
    expect(event!.dataTransfer!.getData('text/plain')).toBe('receive');
    const [target] = event!.getTargetRanges();
    expect(textUnder(target!)).toBe('recieve');
  });

  it('waits for the editor to sync its selection, but only for a frame', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    const adapter = adapterOn(host);
    const events = beforeInputsOn(host);

    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const outcome = adapter.replace(SLIP, 'recieve', 'receive');
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toHaveLength(0);

    document.dispatchEvent(new Event('selectionchange'));
    await expect(outcome).resolves.toBe('attempted');
    expect(events).toHaveLength(1);

    vi.unstubAllGlobals();
    installStaticRange();
    installTargetRanges();
    const capped = adapter.replace(SLIP, 'recieve', 'receive');
    await vi.advanceTimersByTimeAsync(50);
    await expect(capped).resolves.toBe('attempted');
    expect(events).toHaveLength(2);
  });

  it.each([
    ['replaced the selected word', 'I  it.'],
    ['edited the text elsewhere', 'I recieve it. And'],
  ])('is stale, and sends nothing, when a key %s while it waited for the editor', async (_, typed) => {
    const host = addEditable('<p>I recieve it.</p>');
    const adapter = adapterOn(host);
    const events = beforeInputsOn(host);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    const outcome = adapter.replace(SLIP, 'recieve', 'receive');
    await vi.advanceTimersByTimeAsync(0);
    host.firstElementChild!.firstChild!.textContent = typed;
    document.dispatchEvent(new Event('selectionchange'));

    await expect(outcome).resolves.toBe('stale');
    expect(events).toEqual([]);
    expect(execCommand).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    installStaticRange();
    installTargetRanges();
  });

  it('falls back to the editing command when nobody claimed the event and the word is still there', async () => {
    const adapter = adapterOn(addEditable('<p>I recieve it.</p>'));

    await replace(adapter);

    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'receive');
  });

  it('does not use the editing command when an editor claimed the event', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    const adapter = adapterOn(host);
    beforeInputsOn(host, true);

    expect(await replace(adapter)).toBe('attempted');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('does not use the editing command once the word changed under the event', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    const adapter = adapterOn(host);
    host.addEventListener('beforeinput', () => {
      host.firstElementChild!.firstChild!.textContent = 'I receive it.';
    });

    await replace(adapter);

    expect(execCommand).not.toHaveBeenCalled();
  });

  it('never uses the editing command in Slate', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    host.setAttribute('data-slate-editor', 'true');
    const adapter = adapterOn(host);

    expect(await replace(adapter)).toBe('attempted');
    expect(execCommand).not.toHaveBeenCalled();
  });
});
