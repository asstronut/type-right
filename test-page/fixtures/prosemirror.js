import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { schema } from 'prosemirror-schema-basic';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { expose } from './fixture.js';
import { buildPage, check, getVariant, remount, tallerThanScroller, textboxAttributes } from './layout.js';
import { elementsNotChecked, findLastWord, inlineCode, modelText } from './pm-shared.js';
import { FILLER, countCycleWords, hasStubWord, longParagraphs } from './prose.js';

const { column, library } = __FIXTURE__;
const variant = getVariant('long');
const page = buildPage(column);
const { scroller, otherScroller } = page;
let mount = page.mount;

const paragraph = (...parts) =>
  schema.node('paragraph', null, parts.map((part) => (typeof part === 'string' ? schema.text(part) : part)));
const inlineCodeText = (text) => schema.text(text, [schema.marks.code.create()]);

function seededDoc() {
  return schema.node('doc', null, [
    paragraph('Hello team, here is a short update on the migration. It occured on Tuesday night and everything is back to normal.'),
    paragraph('The checklist below shows what changed in the last release. Read it carefully and flag anything that looks wrong before the review on Thursday.'),
    paragraph(FILLER),
    schema.node('code_block', null, schema.text('if (invoice.adress) {\n  send(invoice);\n}')),
    schema.node('blockquote', null, [paragraph('Budi wrote: please send the files to the new adress by noon and confirm.')]),
    paragraph('To refresh the numbers I ran ', inlineCodeText('refresh_all.py'), ' this morning, then checked the totals twice.'),
    paragraph('There is one seperate task left, so I will definately finish it before the weekend.'),
  ]);
}

function longDoc() {
  return schema.node('doc', null, longParagraphs().map((text) => paragraph(text)));
}

const plugins = [
  history(),
  keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo, 'Mod-b': toggleMark(schema.marks.strong) }),
  keymap(baseKeymap),
];

function mountView(doc) {
  return new EditorView(mount, {
    state: EditorState.create({ doc, plugins }),
    attributes: { role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true', 'aria-label': 'Ask ChatGPT', translate: 'no' },
  });
}

let view = mountView(variant === 'long' ? longDoc() : seededDoc());

const typingBlock = () => view.dom.lastElementChild;

function seeds() {
  const host = view.dom;
  const text = modelText(view.state.doc);
  const taller = tallerThanScroller(host, scroller);
  if (variant === 'long') {
    const paragraphs = host.querySelectorAll(':scope > p').length;
    const words = countCycleWords(text);
    return [
      check('50k prose', text.length >= 48000 && text.length <= 52000, `${text.length} chars`),
      check('500 paragraphs', paragraphs >= 480, `${paragraphs} paragraphs`),
      check('800 stub words', words >= 720 && words <= 880, `${words} stub words`),
      check('only prose', !host.querySelector('pre, blockquote, code')),
      taller,
    ];
  }
  const pre = host.querySelector('pre');
  const quote = host.querySelector('blockquote');
  const code = inlineCode(host)[0];
  return [
    textboxAttributes(host),
    check('code block', pre?.textContent.includes('adress'), 'pre'),
    check('blockquote', quote?.textContent.includes('adress'), 'blockquote'),
    check('inline code', code?.textContent === 'refresh_all.py', 'p > code'),
    check('typing block after the seeded regions', typingBlock().tagName === 'P' && hasStubWord(typingBlock().textContent), typingBlock().textContent),
    taller,
  ];
}

function bold(word) {
  const { from, to } = findLastWord(view.state.doc, word, ['code_block', 'blockquote']);
  view.dispatch(view.state.tr.addMark(from, to, schema.marks.strong.create()));
}

function remoteEdit(text) {
  const node = paragraph(text);
  view.dispatch(view.state.tr.insert(0, node).setMeta('addToHistory', false));
}

function replaceRoot() {
  const { doc } = view.state;
  view.destroy();
  mount = remount(mount);
  view = mountView(doc);
  return view.dom;
}

expose({
  column,
  variant,
  library,
  host: () => view.dom,
  text: () => modelText(view.state.doc),
  seeds,
  typingBlock,
  notChecked: () => elementsNotChecked(view.dom),
  neverFlag: () => inlineCode(view.dom),
  decoys: () => [],
  bold,
  remoteEdit,
  replaceRoot,
  scroller: () => scroller,
  otherScroller: () => otherScroller,
});
