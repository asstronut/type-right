// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FieldRead } from './field';
import { textareaAdapter } from './textarea';
import { makeSlipId, type Slip } from '../../../lib/slips';

const TEXT = 'I will recieve it.';
const SLIP: Slip = {
  id: makeSlipId('spelling', 'recieve'),
  start: 7,
  end: 14,
  kind: 'spelling',
  type: 'misspelling',
  explanation: 'Spelling mistake',
  suggestions: ['receive'],
  source: 'languagetool',
};

let textarea: HTMLTextAreaElement;
let reads: FieldRead[];
let listening: AbortController;

beforeEach(() => {
  textarea = document.body.appendChild(document.createElement('textarea'));
  textarea.createValueRange = (start, end) => ({ startOffset: start, endOffset: end }) as OpaqueRange;
  reads = [];
  listening = new AbortController();
  textareaAdapter(textarea).watch((read) => reads.push(read), listening.signal);
});

afterEach(() => {
  listening.abort();
  document.body.replaceChildren();
});

function type(text: string): void {
  textarea.value = text;
  textarea.dispatchEvent(new InputEvent('input'));
}

function covered(read: FieldRead): string {
  const range = read.rangeFor(SLIP);
  return textarea.value.slice(range.startOffset, range.endOffset);
}

it('ranges over the words of its read, and over nothing once a script changed the text', () => {
  type(TEXT);
  const read = reads.at(-1)!;
  expect(covered(read)).toBe('recieve');

  textarea.value = 'A different message, set by the site.';

  expect(covered(read)).toBe('');
});

it('replaces the flagged words without the editing command too, and the fix is read like typing', async () => {
  document.execCommand = () => false;
  type(TEXT);

  await textareaAdapter(textarea).replace(SLIP, 'recieve', 'receive');

  expect(textarea.value).toBe('I will receive it.');
  expect(reads.at(-1)!.text).toBe('I will receive it.');
});

it('leaves the text alone once the flagged words are gone', async () => {
  type(TEXT);
  textarea.value = '';

  await textareaAdapter(textarea).replace(SLIP, 'recieve', 'receive');

  expect(textarea.value).toBe('');
});
