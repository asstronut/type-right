// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRichTextReader, REGION_RULES, type RegionRules } from './rich-text';
import { installStaticRange, textUnder } from '../test-static-range';

const ZERO_WIDTH_SPACE = '\u200b';
const BYTE_ORDER_MARK = '\ufeff';
const WORD_JOINER = '\u2060';
const NO_BREAK_SPACE = '\u00a0';
const OBJECT_REPLACEMENT = String.fromCharCode(0xfffc);

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

    expect(text).toBe('Reminder for @team: it is due.\n\n\nPlease be carefull');
  });

  it("reads Gmail's bare text beside divs, its trailing breaks as lines, without its signature or quoted history", () => {
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
      "@budi thanks for fixing the bug!\nThe build passed on the first try.\n\nBudi's note was short. Let's hope it works everywhere ✅ See https://example.com/pull/42 if you want to check the diffrence.",
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
    ['images that are not emoji', '<p>A <img alt="smile" src="x"> B</p>', 'A  B'],
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

      const words = [...text.matchAll(new RegExp(`[^\\s${OBJECT_REPLACEMENT}]+`, 'g'))];
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

function spansOf(read: { text: string; neverFlag: { start: number; end: number }[] }): string[] {
  return read.neverFlag.map(({ start, end }) => read.text.slice(start, end));
}

describe('regions that are not checked', () => {
  it.each<[string, string, string]>([
    ['a code block', '<p>before</p><pre><code>if (x.adress) {}</code></pre><p>after</p>', 'before\n\nafter'],
    ["Quill 1.3's code block", '<p>before</p><pre class="ql-syntax">x.adress();\n</pre><p>after</p>', 'before\n\nafter'],
    [
      "Quill 2's code lines",
      '<p>before</p><div class="ql-code-block-container"><div class="ql-code-block">x.adress();</div></div><p>after</p>',
      'before\n\nafter',
    ],
    ['a code line outside any container', '<p>before</p><div class="ql-code-block">x.adress();</div><p>after</p>', 'before\n\nafter'],
    ['a blockquote of paragraphs', '<p>before</p><blockquote><p>a adress</p><p>b</p></blockquote><p>after</p>', 'before\n\nafter'],
    ['a region at the start', '<blockquote>quoted</blockquote><p>after</p>', '\nafter'],
    ['a region at the end', '<p>before</p><pre>code</pre>', 'before'],
    ['a region in the middle of a line', '<div>one <blockquote>quoted</blockquote> two</div>', 'one \n\n two'],
    [
      "Draft.js's nested code block",
      '<div><div>A</div></div><pre><pre data-block="true"><div><span>code adress</span></div></pre></pre><div><div>B</div></div>',
      'A\n\nB',
    ],
    ['a region deep in wrappers', '<p>a</p><div><div><pre>x</pre></div></div><p>b</p>', 'a\n\nb'],
  ])('puts an empty line in place of %s', (_, html, expected) => {
    expect(textOf(html)).toBe(expected);
  });

  it('keeps the prose after a region at the right offsets', () => {
    const { text, rangeFor } = readOf('<p>before</p><pre>x.adress</pre><p>an adress here</p>');

    expect(text).toBe('before\n\nan adress here');
    expect(textUnder(rangeFor(spanOf(text, 'adress')))).toBe('adress');
  });

  it('never looks inside a region', () => {
    const host = mount('<p>A</p><pre><code>deep</code></pre><p>B</p>');
    const childNodes = vi.spyOn(host.querySelector('pre')!, 'childNodes', 'get');

    createRichTextReader(host).read();

    expect(childNodes).not.toHaveBeenCalled();
  });

  it('reads the selectors it is given instead of the built-in ones', () => {
    const rules: RegionRules = { notChecked: ['.sig'], neverFlag: [] };
    const host = mount('<p>A</p><div class="sig">Sender</div><pre>kept</pre>');

    expect(createRichTextReader(host, rules).read().text).toBe('A\n\nkept');
  });

  it('checks everything when it is given no selectors', () => {
    const host = mount('<p>A</p><pre>kept</pre><p>B <code>c</code></p>');

    const read = createRichTextReader(host, { notChecked: [], neverFlag: [] }).read();

    expect(read.text).toBe('A\nkept\nB c');
    expect(read.neverFlag).toEqual([]);
  });

  it('has the generic selectors built in', () => {
    expect(REGION_RULES.notChecked).toEqual(
      expect.arrayContaining(['pre', 'blockquote', '.ql-code-block', '.gmail_signature', '.gmail_signature_prefix', '.gmail_quote']),
    );
    expect(REGION_RULES.neverFlag).toEqual(expect.arrayContaining(['code', '[contenteditable="false"]']));
  });
});

const GMAIL_COMPOSE =
  `<div><div class="gmail_default" style="font-family: georgia, serif;">​<span style="font-family: Arial, Helvetica, sans-serif; background-color: transparent;">@budi thanks for fixing the bug! I merged your change into \`main\`.</span></div>The build passed on the first try.<br><br>Budi's note was short: "it works on my machine." Let's hope it works everywhere <img data-emoji="✅" class="an1" alt="✅" aria-label="✅" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/17.0/2705/72.png" loading="lazy"> See https://example.com/pull/42 if you want to check the diffrence.<br clear="all"></div><div><br></div><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature"><div dir="ltr"><font face="georgia,serif">Sender Name<br></font></div></div>`;

const GMAIL_REPLY =
  '<div dir="ltr">Thanks, i will recieve it.</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Mon, Oct 20, 2025 at 9:00 AM Budi &lt;budi@example.com&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><div dir="ltr">Quoted adress here.</div></blockquote></div>';

describe("Gmail's signature and quoted history", () => {
  it('leaves the signature and its "-- " line out of the read', () => {
    const { text } = readOf(GMAIL_COMPOSE);

    expect(text).not.toContain('Sender Name');
    expect(text).not.toContain('--');
    expect(text.endsWith('the diffrence.')).toBe(true);
  });

  it('leaves the quoted history of a reply out of the read', () => {
    const { text } = readOf(GMAIL_REPLY);

    expect(text).toBe('Thanks, i will recieve it.');
  });

  it('keeps an empty line in place of the signature when typed text follows it', () => {
    expect(textOf('<p>A</p><div class="gmail_signature">Sender</div><p>B</p>')).toBe('A\n\nB');
  });

  it('leaves the line being typed unfinished however many spacers sit before the signature', () => {
    const typing = '<div>Hello wor</div><div><br></div><span class="gmail_signature_prefix">-- </span><br><div class="gmail_signature">Sender</div>';

    expect(textOf(typing)).toBe('Hello wor');
  });

  it('keeps the offsets of the checked text', () => {
    const { text, rangeFor } = readOf(GMAIL_COMPOSE);

    expect(textUnder(rangeFor(spanOf(text, 'diffrence')))).toBe('diffrence');
  });
});

describe('content that is never flagged', () => {
  it('keeps a Slack mention chip in the text as its label', () => {
    const read = readOf('<p>Thanks <ts-mention spellcheck="false" data-label="@Dana">@Dana</ts-mention> for the fix</p>');

    expect(read.text).toBe('Thanks @Dana for the fix');
    expect(spansOf(read)).toEqual(['@Dana']);
  });

  it('keeps a TipTap mention chip in the text as its label', () => {
    const read = readOf('<p>Hi <span data-type="mention" data-id="dana">Dana Lee</span>, welcome</p>');

    expect(read.text).toBe('Hi Dana Lee, welcome');
    expect(spansOf(read)).toEqual(['Dana Lee']);
  });

  it('reads a chip that holds markup and line breaks as its label on one line', () => {
    const read = readOf(
      '<p>See <span contenteditable="false">\n  <span class="icon"><svg></svg></span><span>report\n.pdf</span><div>final</div></span> now</p>',
    );

    expect(read.text).toBe('See report .pdffinal now');
    expect(spansOf(read)).toEqual(['report .pdffinal']);
  });

  it('keeps inline code in the text and flags the whole of it', () => {
    const read = readOf('<p>I ran <code>refresh_all.py</code> twice</p>');

    expect(read.text).toBe('I ran refresh_all.py twice');
    expect(spansOf(read)).toEqual(['refresh_all.py']);
  });

  it('joins neighbouring never-flag content into one span and keeps others apart', () => {
    const read = readOf('<p><code>a</code><code>b</code> and <code>c</code></p>');

    expect(spansOf(read)).toEqual(['ab', 'c']);
  });

  it('flags nothing on a line that follows a chip', () => {
    const read = readOf('<p>Hi <code>a</code></p><p>b</p>');

    expect(read.text).toBe('Hi a\nb');
    expect(read.neverFlag).toEqual([{ start: 3, end: 4 }]);
  });

  it('leaves a block-level element a block, whatever its contenteditable', () => {
    const read = readOf('<p>A</p><div contenteditable="false">card</div><p>B</p>');

    expect(read.text).toBe('A\ncard\nB');
    expect(read.neverFlag).toEqual([]);
  });

  it('adds nothing for an empty chip', () => {
    const read = readOf('<p>A<span contenteditable="false"></span>B</p>');

    expect(read.text).toBe('AB');
    expect(read.neverFlag).toEqual([]);
  });

  describe('image emoji', () => {
    it('is the alt emoji when the alt is a single emoji', () => {
      const read = readOf('<p>Done <img data-emoji="✅" class="an1" alt="✅" src="x"> ok</p>');

      expect(read.text).toBe('Done ✅ ok');
      expect(spansOf(read)).toEqual(['✅']);
    });

    it.each([
      ['a flag', '🇮🇩'],
      ['a family sequence', '👨‍👩‍👧'],
      ['a skin-toned emoji', '👍🏽'],
    ])('keeps %s whole', (_, alt) => {
      const read = readOf(`<p>a <img class="emoji" alt="${alt}"> b</p>`);

      expect(read.text).toBe(`a ${alt} b`);
      expect(spansOf(read)).toEqual([alt]);
    });

    it.each([
      ['a name', 'slightly smiling face emoji'],
      ['two emoji', '😀😀'],
      ['an emoji and a word', '😀 smile'],
      ['a lone digit', '1'],
      ['empty', ''],
    ])('is U+FFFC when the alt is %s', (_, alt) => {
      const read = readOf(`<p>a <img class="emoji" alt="${alt}"> b</p>`);

      expect(read.text).toBe(`a ${OBJECT_REPLACEMENT} b`);
      expect(spansOf(read)).toEqual([OBJECT_REPLACEMENT]);
    });

    it.each([
      ['inside the image', (image: HTMLElement) => image.append(BYTE_ORDER_MARK, BYTE_ORDER_MARK)],
      ['beside the image', (image: HTMLElement) => {
        image.before(BYTE_ORDER_MARK);
        image.after(BYTE_ORDER_MARK);
      }],
    ])("is one character with Slack's U+FEFF guards %s, and offsets after it do not drift", (_, addGuards) => {
      const host = mount('<p>Great <img class="emoji" alt="slightly smiling face emoji" src="x"> and the remaning charts.</p>');
      addGuards(host.querySelector('img')!);

      const { text, neverFlag, rangeFor } = createRichTextReader(host).read();

      expect(text).toBe(`Great ${OBJECT_REPLACEMENT} and the remaning charts.`);
      expect(neverFlag).toEqual([{ start: 6, end: 7 }]);
      expect(textUnder(rangeFor(spanOf(text, 'remaning')))).toBe('remaning');
      expect(textUnder(rangeFor(spanOf(text, 'Great')))).toBe('Great');
    });

    it('leaves a non-emoji image out of the text', () => {
      const read = readOf('<p>A <img alt="chart" src="x"> B</p>');

      expect(read.text).toBe('A  B');
      expect(read.neverFlag).toEqual([]);
    });

    it('counts an emoji image inside a chip once', () => {
      const read = readOf('<p>A <span contenteditable="false">go <img class="emoji" alt="🚀"></span> B</p>');

      expect(read.text).toBe('A go 🚀 B');
      expect(spansOf(read)).toEqual(['go 🚀']);
    });
  });

  it('keeps the ranges of the prose around a chip on its own text nodes', () => {
    const { host, text, rangeFor } = readOf('<p>I recieve <ts-mention contenteditable="false">@Dana</ts-mention> and recieve it</p>');

    const before = rangeFor({ start: 2, end: 9 });
    const after = rangeFor({ start: text.lastIndexOf('recieve'), end: text.lastIndexOf('recieve') + 7 });

    expect(textUnder(before)).toBe('recieve');
    expect(before.endContainer).toBe(textNodeOf(host, 'I recieve '));
    expect(textUnder(after)).toBe('recieve');
    expect(after.startContainer).toBe(textNodeOf(host, ' and recieve it'));
  });
});
