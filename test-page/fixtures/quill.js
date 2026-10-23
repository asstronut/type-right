import Quill from 'quill';
import 'quill/dist/quill.core.css';
import { expose } from './fixture.js';
import { buildPage, check, getVariant, remount, tallerThanScroller, textboxAttributes } from './layout.js';
import { SMILE_EMOJI } from './images.js';

const { column, library } = __FIXTURE__;
const variant = getVariant();
const page = buildPage(column);
const { scroller, otherScroller } = page;
let mount = page.mount;

const Delta = Quill.import('delta');
const Parchment = Quill.import('parchment');
const Embed = Quill.import('blots/embed');

class MentionBlot extends Parchment.Embed {
  static blotName = 'mention';
  static tagName = 'ts-mention';

  static create(value) {
    const node = super.create();
    node.setAttribute('data-id', value.id);
    node.setAttribute('data-label', value.label);
    node.setAttribute('spellcheck', 'false');
    node.setAttribute('dir', 'ltr');
    node.setAttribute('class', 'c-member_slug c-member_slug--link ts_tip_texty');
    node.textContent = value.label;
    return node;
  }

  static value(node) {
    return { id: node.getAttribute('data-id'), label: node.getAttribute('data-label') };
  }
}

class EmojiBlot extends Embed {
  static blotName = 'emoji';
  static tagName = 'img';
  static className = 'emoji';

  static create(value) {
    const node = super.create();
    node.setAttribute('src', SMILE_EMOJI);
    node.setAttribute('alt', value.alt);
    node.setAttribute('data-id', value.id);
    node.setAttribute('data-title', value.id);
    node.setAttribute('data-stringify-text', value.id);
    return node;
  }

  static value(node) {
    return { id: node.getAttribute('data-id'), alt: node.getAttribute('alt') };
  }
}

Quill.register(MentionBlot);
Quill.register(EmojiBlot);

function seededContents() {
  return new Delta()
    .insert('Hi ')
    .insert({ mention: { id: 'U0DANA', label: '@Dana' } })
    .insert(', the weekly report is ready for review. I ran ')
    .insert('refresh_all.py', { code: true })
    .insert(' this morning.\n')
    .insert('Please check the totals before noon and keep the numbers in sync.\n')
    .insert('if (invoice.recieve) {\n  send(invoice);\n}')
    .insert('\n', { 'code-block': true })
    .insert('Budi wrote: please recieve the files by noon and confirm.')
    .insert('\n', { blockquote: true })
    .insert('Priya said "the numbers look fine" yesterday, so we are almost done ')
    .insert({ emoji: { id: ':slightly_smiling_face:', alt: 'slightly smiling face emoji' } })
    .insert(" The full report is at https://example.com/weekly-report and I'll send the remaning charts later.\n");
}

function createQuill(container, contents) {
  const instance = new Quill(container, { modules: { toolbar: false } });
  instance.setContents(contents, 'api');
  instance.history.clear();
  const { root } = instance;
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.setAttribute('aria-label', 'Message to Slackbot');
  root.setAttribute('spellcheck', 'true');
  root.setAttribute('data-gramm', 'false');
  root.setAttribute('dir', 'auto');
  instance.container.querySelector('.ql-clipboard').setAttribute('aria-hidden', 'true');
  return instance;
}

let quill = createQuill(mount, seededContents());

const host = () => quill.root;
const clipboard = () => quill.container.querySelector('.ql-clipboard');
const typingBlock = () => quill.root.lastElementChild;
const inlineCode = () => [...quill.root.querySelectorAll('code')].filter((code) => !code.closest('pre'));

function lines() {
  const result = [];
  let index = 0;
  let start = 0;
  let line = '';
  for (const op of quill.getContents().ops) {
    if (typeof op.insert !== 'string') {
      line += '￼';
      index += 1;
      continue;
    }
    for (const char of op.insert) {
      if (char === '\n') {
        result.push({ start, text: line, attributes: op.attributes ?? {} });
        start = index + 1;
        line = '';
      } else {
        line += char;
      }
      index += char.length;
    }
  }
  return result;
}

function seeds() {
  const root = host();
  const chip = root.querySelector('ts-mention');
  const emoji = root.querySelector('img.emoji');
  const pre = root.querySelector('pre');
  const quote = root.querySelector('blockquote');
  const code = inlineCode()[0];
  const guards = emoji ? [...emoji.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.data) : [];
  const typing = typingBlock();
  return [
    textboxAttributes(root),
    check('mention chip', chip?.textContent === '@Dana' && chip.getAttribute('data-label') === '@Dana', chip?.outerHTML),
    check(
      'image emoji with U+FEFF guards',
      emoji?.src.startsWith('data:') && guards.length === 2 && guards.every((guard) => guard === '﻿'),
      `guards ${JSON.stringify(guards)}, children of ${emoji?.tagName}`,
    ),
    check('code block', pre?.matches('pre.ql-syntax') && pre.textContent.includes('recieve'), 'pre.ql-syntax (Quill 1.3 has no .ql-code-block)'),
    check('blockquote', quote?.textContent.includes('recieve'), 'blockquote'),
    check('inline code', code?.textContent === 'refresh_all.py', 'p > code'),
    check('decoy: hidden ql-clipboard', clipboard()?.getAttribute('contenteditable') === 'true' && clipboard().getAttribute('aria-hidden') === 'true', 'div.ql-clipboard'),
    check('remaning after the emoji', typing.tagName === 'P' && typing.textContent.split('﻿').pop().includes('remaning'), typing.textContent),
    tallerThanScroller(root, scroller),
  ];
}

function bold(word) {
  const line = lines()
    .filter(({ attributes }) => !attributes['code-block'] && !attributes.blockquote)
    .findLast(({ text }) => text.includes(word));
  if (!line) throw new Error(`"${word}" is not in the document outside its code blocks and quotes`);
  quill.formatText(line.start + line.text.lastIndexOf(word), word.length, 'bold', true, 'api');
}

function remoteEdit(text) {
  quill.updateContents(new Delta().insert(`${text}\n`), 'api');
}

function replaceRoot() {
  const contents = quill.getContents();
  const old = quill.container;
  quill = null;
  mount = remount(old);
  quill = createQuill(mount, contents);
  return host();
}

expose({
  column,
  variant,
  library,
  host,
  text: () => quill.getText().replace(/\n$/, ''),
  seeds,
  typingBlock,
  notChecked: () => [...host().querySelectorAll('pre, blockquote')],
  neverFlag: () => [...host().querySelectorAll('ts-mention, img.emoji'), ...inlineCode()],
  decoys: () => [{ name: 'hidden div.ql-clipboard', element: clipboard(), poke: 'paste' }],
  bold,
  remoteEdit,
  replaceRoot,
  scroller: () => scroller,
  otherScroller: () => otherScroller,
});
