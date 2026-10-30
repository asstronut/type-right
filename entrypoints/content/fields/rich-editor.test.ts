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

const nextBatch = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
    richEditorAdapter(host).watch((read) => reads.push(read), listening.signal);
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

  it('offers no Apply and replaces nothing', async () => {
    const host = addEditable('<p>I recieve it.</p>');
    const adapter = richEditorAdapter(host);

    expect(adapter.canApply(SLIP)).toBe(false);
    await adapter.replace(SLIP, 'recieve', 'receive');

    expect(host.textContent).toBe('I recieve it.');
  });
});
