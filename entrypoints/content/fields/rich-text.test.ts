// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRichTextReader } from './rich-text';
import { installStaticRange, textUnder } from '../test-static-range';

const ZERO_WIDTH_SPACE = '\u200b';
const BYTE_ORDER_MARK = '\ufeff';
const WORD_JOINER = '\u2060';
const NO_BREAK_SPACE = '\u00a0';

function mount(html: string): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'));
  host.setAttribute('contenteditable', 'true');
  host.innerHTML = html;
  return host;
}

function textOf(html: string): string {
  return createRichTextReader(mount(html)).read().text;
}

function readOf(html: string) {
  const host = mount(html);
  return { host, ...createRichTextReader(host).read() };
}

function spanOf(text: string, word: string) {
  const start = text.indexOf(word);
  expect(start, `"${word}" is in the text`).toBeGreaterThanOrEqual(0);
  return { start, end: start + word.length };
}

function textNodeOf(host: HTMLElement, content: string): Text {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && node.data.includes(content)) return node;
  }
  throw new Error(`no text node holds "${content}"`);
}

beforeEach(() => {
  installStaticRange();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('the text of blocks', () => {
  it.each<[string, string, string]>([
    ['blocks are joined by one line break', '<p>First</p><p>Second</p><div>Third</div>', 'First\nSecond\nThird'],
    ['bare text in the host is a line', 'Hello <b>big</b> <a href="#">world</a>', 'Hello big world'],
    ['the last block has no trailing line break', '<p>One</p><p>Two</p>', 'One\nTwo'],
    ['a list item holding a paragraph is one line', '<ul><li><p>one</p></li><li><p>two</p></li></ul>', 'one\ntwo'],
    ['a quote holding paragraphs is one line each', '<blockquote><p>a</p><p>b</p></blockquote><p>c</p>', 'a\nb\nc'],
    ['bare text beside a block is its own line', 'Bare<div>div</div>tail', 'Bare\ndiv\ntail'],
    ['a block inside an inline element is still a block', '<p>a</p><a href="#"><div>b</div></a><p>c</p>', 'a\nb\nc'],
    ['headings and table cells are blocks', '<h1>Title</h1><table><tbody><tr><td>x</td><td>y</td></tr></tbody></table>', 'Title\nx\ny'],
    ['an empty editor is an empty text', '', ''],
  ])('%s', (_, html, expected) => {
    expect(textOf(html)).toBe(expected);
  });

  it('puts one line break at each boundary of Draft.js nested blocks', () => {
    const text = textOf(
      '<div data-contents="true">' +
        '<div data-block="true"><div class="public-DraftStyleDefault-block"><span><span data-text="true">Reminder for </span></span>' +
        '<span style="color: rgb(29, 155, 240);"><span><span data-text="true">@team</span></span></span>' +
        '<span><span data-text="true">: it is due.</span></span></div></div>' +
        '<pre class="public-DraftStyleDefault-pre"><pre data-block="true"><div class="public-DraftStyleDefault-block">' +
        '<span><span data-text="true">if (answers.adress) {\n  save(answers);\n}</span></span></div></pre></pre>' +
        '<div data-block="true"><div><span><br data-text="true"></span></div></div>' +
        '<div data-block="true"><div><span><span data-text="true">Please be carefull</span></span></div></div>' +
        '</div>',
    );

    expect(text).toBe('Reminder for @team: it is due.\nif (answers.adress) {\n  save(answers);\n}\n\nPlease be carefull');
  });

  it("reads Gmail's bare text beside divs, its trailing breaks and its signature as lines", () => {
    const text = textOf(
      '<div><div class="gmail_default">' +
        ZERO_WIDTH_SPACE +
        '<span style="font-family: Arial;">@budi thanks for fixing the bug!</span></div>' +
        'The build passed on the first try.<br><br>' +
        `Budi's note was short. Let's hope it works everywhere <img data-emoji="✅" alt="✅" src="x"> See https://example.com/pull/42 if you want to check the diffrence.<br clear="all"></div>` +
        '<div><br></div>' +
        '<span class="gmail_signature_prefix">-- </span><br>' +
        '<div class="gmail_signature"><div><font face="georgia,serif">Sender Name<br></font></div></div>' +
        '<div class="gmail_quote"><div class="gmail_attr">On Mon, Oct 19, 2026 at 9:00 AM Budi wrote:<br></div>' +
        '<blockquote class="gmail_quote"><div><div>Hi, the invoice is attached.</div><div>Thanks, Budi</div></div></blockquote></div>',
    );

    expect(text).toBe(
      "@budi thanks for fixing the bug!\nThe build passed on the first try.\n\nBudi's note was short. Let's hope it works everywhere  See https://example.com/pull/42 if you want to check the diffrence.\n\n-- \nSender Name\nOn Mon, Oct 19, 2026 at 9:00 AM Budi wrote:\nHi, the invoice is attached.\nThanks, Budi",
    );
  });
});

describe('empty lines and breaks', () => {
  it.each<[string, string, string]>([
    ['an empty block is an empty line', '<p>A</p><p></p><p>B</p>', 'A\n\nB'],
    ['a block holding only a break is an empty line', '<p>A</p><p><br></p><p>B</p>', 'A\n\nB'],
    ['a lone empty block is an empty text', '<p></p>', ''],
    ['a break inside a block is a line break', '<p>one<br>two</p>', 'one\ntwo'],
    ['two breaks in a row are an empty line', '<p>one<br><br>two</p>', 'one\n\ntwo'],
    ['a break between divs is an empty line', '<div>A</div><br><div>B</div>', 'A\n\nB'],
    ['a trailing break adds nothing', '<p>A<br class="ProseMirror-trailingBreak"></p>', 'A'],
    ['a trailing break after a text-less formatting node adds nothing', `<p>A<br>${ZERO_WIDTH_SPACE}</p>`, 'A'],
    ['a second trailing break leaves the empty line it makes', '<p>A<br><br></p><p>B</p>', 'A\n\nB'],
    ["Quill's empty paragraph is an empty line", '<p>A</p><p><br></p>', 'A\n'],
    ["Gmail's clearing break at the end of a line adds nothing", '<div>A<br clear="all"></div><div>B</div>', 'A\nB'],
    ["Draft.js's empty block is an empty line", '<div><div><span><br data-text="true"></span></div></div><div><div>B</div></div>', '\nB'],
    [
      "Slate's zero-width break is an empty line",
      `<p><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-zero-width="n" data-slate-length="0">${BYTE_ORDER_MARK}<br></span></span></span></p><p>B</p>`,
      '\nB',
    ],
  ])('%s', (_, html, expected) => {
    expect(textOf(html)).toBe(expected);
  });

  it('ignores the whitespace that formats markup between blocks, but keeps it in a block of text', () => {
    expect(textOf('<div>\n  <div>A</div>\n  <div>B</div>\n</div>')).toBe('A\nB');
    expect(textOf('<p>A</p>\n<p> </p>\n<p>B</p>')).toBe('A\n \nB');
  });
});

describe('what is not in the text', () => {
  it.each<[string, string, string]>([
    ['a leading zero-width space', `${ZERO_WIDTH_SPACE}Hello`, 'Hello'],
    ['a zero-width span at the end of a leaf', `<span>Hello</span><span data-slate-zero-width="z" data-slate-length="0">${BYTE_ORDER_MARK}</span>`, 'Hello'],
    ['zero-width characters in the middle of a text node', `ab${ZERO_WIDTH_SPACE}cd${WORD_JOINER}ef${BYTE_ORDER_MARK}`, 'abcdef'],
    ['scripts and styles', '<p>A<script>x()</script><style>p { color: red }</style></p>', 'A'],
    ['templates and noscript', '<p>A<template>t</template><noscript>n</noscript>B</p>', 'AB'],
    ['images', '<p>A <img alt="smile" src="x"> B</p>', 'A  B'],
    ['icons and embedded content', '<p>A<svg><title>Remove</title></svg><select><option>One</option></select>B</p>', 'AB'],
    ['a hidden block, without a line of its own', '<p>A</p><p hidden>H</p><p>B</p>', 'A\nB'],
    ['aria-hidden nodes', '<p>A<span aria-hidden="true">H</span>B</p>', 'AB'],
    ['nodes with display: none', '<p>A<span style="display: none">H</span>B</p>', 'AB'],
    ["Slate's placeholder", '<p><span data-slate-placeholder="true">Type a message</span></p>', ''],
    ['nothing for aria-hidden="false"', '<p>A<span aria-hidden="false">B</span></p>', 'AB'],
  ])('%s', (_, html, expected) => {
    expect(textOf(html)).toBe(expected);
  });

  it('maps a no-break space to a space of the same length', () => {
    expect(textOf(`<p>a${NO_BREAK_SPACE}b${NO_BREAK_SPACE}${NO_BREAK_SPACE}c</p>`)).toBe('a b  c');
  });
});

describe('ranges over the text', () => {
  it('lands a word split by formatting in each node it spans', () => {
    const { host, text, rangeFor } = readOf('<p>I rec<b>ie</b>ve it</p>');

    const range = rangeFor(spanOf(text, 'recieve'));

    expect(range.startContainer).toBe(textNodeOf(host, 'I rec'));
    expect(range.startOffset).toBe(2);
    expect(range.endContainer).toBe(textNodeOf(host, 've it'));
    expect(range.endOffset).toBe(2);
    expect(textUnder(range)).toBe('recieve');
  });

  it('keeps the end of a word that ends at a node boundary in its own node', () => {
    const { host, text, rangeFor } = readOf('<p>I <b>rec</b>ieve it</p>');

    const range = rangeFor(spanOf(text, 'rec'));

    expect(range.startContainer).toBe(textNodeOf(host, 'rec'));
    expect(range.startOffset).toBe(0);
    expect(range.endContainer).toBe(textNodeOf(host, 'rec'));
    expect(range.endOffset).toBe(3);
  });

  it('starts a word that begins at a node boundary in the node that holds it', () => {
    const { host, text, rangeFor } = readOf('<p>I <b>rec</b>ieve it</p>');

    const range = rangeFor(spanOf(text, 'ieve'));

    expect(range.startContainer).toBe(textNodeOf(host, 'ieve it'));
    expect(range.startOffset).toBe(0);
  });

  it('starts a word right after a removed zero-width character where the word starts', () => {
    const { host, text, rangeFor } = readOf(`<p>${ZERO_WIDTH_SPACE}hello world</p>`);

    const range = rangeFor(spanOf(text, 'hello'));

    expect(range.startContainer).toBe(textNodeOf(host, 'hello'));
    expect(range.startOffset).toBe(1);
    expect(range.endOffset).toBe(6);
    expect(textUnder(range)).toBe('hello');
  });

  it('leaves a zero-width character in the middle of a word inside its range', () => {
    const { host, text, rangeFor } = readOf(`<p>ab${ZERO_WIDTH_SPACE}cd ef</p>`);

    const range = rangeFor(spanOf(text, 'abcd'));
    const second = rangeFor(spanOf(text, 'cd'));

    expect([range.startOffset, range.endOffset]).toEqual([0, 5]);
    expect(textUnder(range)).toBe(`ab${ZERO_WIDTH_SPACE}cd`);
    expect(second.startContainer).toBe(textNodeOf(host, 'ab'));
    expect([second.startOffset, second.endOffset]).toEqual([3, 5]);
    expect(textUnder(rangeFor(spanOf(text, 'ef')))).toBe('ef');
  });

  it('maps an offset on a block boundary to the end of the previous text node', () => {
    const { host, text, rangeFor } = readOf('<p>one</p><p>two</p>');

    const range = rangeFor({ start: 3, end: 6 });

    expect(text).toBe('one\ntwo');
    expect(range.startContainer).toBe(textNodeOf(host, 'one'));
    expect(range.startOffset).toBe(3);
    expect(range.endContainer).toBe(textNodeOf(host, 'two'));
    expect(range.endOffset).toBe(2);
  });

  it('maps an offset on a break to the end of the text before it', () => {
    const { host, rangeFor } = readOf('<p>one<br>two</p>');

    const range = rangeFor({ start: 3, end: 3 });

    expect(range.startContainer).toBe(textNodeOf(host, 'one'));
    expect(range.startOffset).toBe(3);
  });

  it('maps an offset before the first text to the first text node', () => {
    const { host, text, rangeFor } = readOf('<p></p><p>A</p>');

    const range = rangeFor({ start: 0, end: 1 });

    expect(text).toBe('\nA');
    expect(range.startContainer).toBe(textNodeOf(host, 'A'));
    expect(range.startOffset).toBe(0);
  });

  it('ranges over an empty editor at the start of the editor', () => {
    const { host, rangeFor } = readOf('');

    const range = rangeFor({ start: 0, end: 0 });

    expect(range.startContainer).toBe(host);
    expect(range.endContainer).toBe(host);
    expect([range.startOffset, range.endOffset]).toEqual([0, 0]);
  });

  describe.each<[string, string]>([
    [
      'ProseMirror',
      '<p>Hello team, an update. It occured on <em>Tuesday</em> night.</p><pre><code>if (invoice.adress) {\n  send(invoice);\n}</code></pre>' +
        '<blockquote><p>Budi wrote: send it to the new adress.</p></blockquote><p>I ran <code>refresh_all.py</code> twice.<br class="ProseMirror-trailingBreak"></p>',
    ],
    [
      'Gmail',
      `<div><div class="gmail_default">${ZERO_WIDTH_SPACE}<span>@budi thanks for fixing the bug!</span></div>The build passed.<br><br>See <b>the</b> diffrence.<br clear="all"></div>` +
        '<div><br></div><span>-- </span><br><div class="gmail_signature"><div><font>Sender Name<br></font></div></div>',
    ],
    [
      'Slate',
      `<p><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-string="true">Please check the numbers. </span></span></span><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-zero-width="z" data-slate-length="0">${BYTE_ORDER_MARK}</span></span></span><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-string="true">Then merge it.</span></span></span></p>` +
        `<p><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-zero-width="n" data-slate-length="0">${BYTE_ORDER_MARK}<br></span></span></span></p>`,
    ],
    [
      'Quill',
      `<p>Hi, the report is ready${NO_BREAK_SPACE}for review. I ran <code>refresh_all.py</code> today.</p><pre class="ql-syntax">if (a) {\n  b();\n}\n</pre><p>Priya said "fine" yesterday <img class="emoji" alt="smile" src="x"> and I'll send the remaning charts.</p>`,
    ],
  ])('on %s-shaped markup', (_, html) => {
    it('gives every word a range that reads back as the word', () => {
      const { text, rangeFor } = readOf(html);

      const words = [...text.matchAll(/\S+/g)];
      expect(words.length).toBeGreaterThan(5);
      for (const { 0: word, index = 0 } of words) {
        const range = rangeFor({ start: index, end: index + word.length });
        expect(range.startContainer.nodeType, word).toBe(Node.TEXT_NODE);
        expect(range.endContainer.nodeType, word).toBe(Node.TEXT_NODE);
        expect(textUnder(range), word).toBe(word);
      }
    });
  });

  it('ranges over nothing once a text node has changed since the read', () => {
    const { host, text, rangeFor } = readOf('<p>I recieve it.</p><p>Another line.</p>');
    const slip = spanOf(text, 'recieve');
    expect(textUnder(rangeFor(slip))).toBe('recieve');

    textNodeOf(host, 'I recieve').data = 'I receive it.';

    const range = rangeFor(slip);
    expect(range.startContainer).toBe(host);
    expect(range.endContainer).toBe(host);
    expect([range.startOffset, range.endOffset]).toEqual([0, 0]);
    expect(textUnder(rangeFor(spanOf(text, 'Another')))).toBe('Another');
  });

  it('ranges over nothing once a text node has left the editor since the read', () => {
    const { host, text, rangeFor } = readOf('<p>I recieve it.</p>');
    const slip = spanOf(text, 'recieve');

    textNodeOf(host, 'I recieve').remove();

    const range = rangeFor(slip);
    expect(range.startContainer).toBe(host);
    expect(range.collapsed).toBe(true);
  });

  it('ranges over nothing when only the end of the span is in a node that changed', () => {
    const { host, text, rangeFor } = readOf('<p>I rec<b>ie</b>ve it</p>');
    const slip = spanOf(text, 'recieve');

    textNodeOf(host, 've it').data = 'vo it';

    expect(rangeFor(slip).collapsed).toBe(true);
    expect(rangeFor(spanOf(text, 'rec')).collapsed).toBe(false);
  });
});

describe('reading again', () => {
  it('reads the editor as it is now, with ranges that belong to that read', () => {
    const host = mount('<p>I recieve it.</p>');
    const reader = createRichTextReader(host);
    const first = reader.read();

    textNodeOf(host, 'I recieve').data = 'Oh no. I recieve it.';
    const second = reader.read();

    expect(first.text).toBe('I recieve it.');
    expect(second.text).toBe('Oh no. I recieve it.');
    expect(textUnder(second.rangeFor(spanOf(second.text, 'recieve')))).toBe('recieve');
  });

  it('reports no span to leave unflagged', () => {
    expect(readOf('<p>Hello</p>').neverFlag).toEqual([]);
  });
});
