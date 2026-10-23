import { Editor } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import { expose } from './fixture.js';
import { buildPage, check, el, getVariant, remount, tallerThanScroller, textboxAttributes } from './layout.js';
import { elementsNotChecked, findLastWord, inlineCode, modelText } from './pm-shared.js';
import { hasStubWord } from './prose.js';

const { column, library } = __FIXTURE__;
const variant = getVariant();
const page = buildPage(column);
const { scroller, otherScroller, slot } = page;
let mount = page.mount;

const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content) => ({ type: 'paragraph', content: content.map((part) => (typeof part === 'string' ? text(part) : part)) });

const seededContent = {
  type: 'doc',
  content: [
    paragraph(
      'Hey ',
      { type: 'mention', attrs: { id: 'dana-lee', label: 'Dana Lee' } },
      ', are you free for lunch on Friday? I found a new cafe near the office.',
    ),
    paragraph('They have a good menu. The owner said "everything is made fresh every day," which sounds promising.'),
    { type: 'codeBlock', content: [text('if (invoice.recieve) {\n  send(invoice);\n}')] },
    { type: 'blockquote', content: [paragraph('Budi wrote: please recieve the files by noon and confirm.')] },
    paragraph('To refresh the numbers I ran ', text('refresh_all.py', [{ type: 'code' }]), ' this morning, then checked the totals twice.'),
    paragraph("Here is the menu: https://example.com/menu. I think it's a bit expensiv, but worth it."),
  ],
};

const MentionChip = Mention.configure({
  renderHTML: ({ options, node }) => [
    'span',
    { ...options.HTMLAttributes, 'data-allow-partial-delete': 'true' },
    ['strong', node.attrs.label],
  ],
});

function createEditor(content) {
  return new Editor({
    element: mount,
    extensions: [StarterKit, MentionChip],
    content,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true', translate: 'no', 'aria-label': 'Write your prompt to Claude' },
    },
  });
}

let editor = createEditor(seededContent);

const decoyTextarea = el('textarea', {
  id: 'static-composer-input',
  'data-testid': 'static-composer-input',
  disabled: '',
  hidden: '',
  rows: '1',
  placeholder: 'How can I help you today…',
  'aria-label': 'Write your prompt to Claude',
  spellcheck: 'true',
});
decoyTextarea.value = 'a dekoy draft';

let dialog = null;
if (variant === 'modal') {
  dialog = el('dialog', { id: 'composer-dialog', 'aria-label': 'Create a post' }, el('h2', { text: 'Create a post' }), decoyTextarea, scroller);
  dialog.style.cssText = 'width: 640px; max-width: calc(100vw - 32px); padding: 16px; border: 1px solid #888; border-radius: 12px;';
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  document.body.append(dialog);
  dialog.showModal();
} else {
  slot.prepend(decoyTextarea);
}

const host = () => editor.view.dom;
const typingBlock = () => host().lastElementChild;

function seeds() {
  const root = host();
  const chip = root.querySelector('span[data-type=mention]');
  const pre = root.querySelector('pre');
  const quote = root.querySelector('blockquote');
  const code = inlineCode(root)[0];
  const checks = [
    textboxAttributes(root),
    check('root is div.tiptap.ProseMirror', root.matches('div.tiptap.ProseMirror[role=textbox]'), root.className),
    check('mention chip', chip?.getAttribute('contenteditable') === 'false' && chip.textContent === 'Dana Lee', chip?.outerHTML),
    check('code block', pre?.textContent.includes('recieve'), 'pre'),
    check('blockquote', quote?.textContent.includes('recieve'), 'blockquote'),
    check('inline code', code?.textContent === 'refresh_all.py', 'p > code'),
    check('typing block after the seeded regions', typingBlock().tagName === 'P' && hasStubWord(typingBlock().textContent), typingBlock().textContent),
    check('decoy: hidden disabled textarea', decoyTextarea.hidden && decoyTextarea.disabled && decoyTextarea.value === 'a dekoy draft', '#static-composer-input'),
    tallerThanScroller(root, scroller),
  ];
  if (variant === 'modal') {
    checks.push(check('modal dialog open', dialog.open && dialog.matches(':modal') && dialog.contains(root), 'dialog:modal'));
  }
  return checks;
}

function bold(word) {
  const { from, to } = findLastWord(editor.state.doc, word, ['codeBlock', 'blockquote']);
  editor.commands.command(({ tr, state }) => {
    tr.addMark(from, to, state.schema.marks.bold.create());
    return true;
  });
}

function remoteEdit(value) {
  editor.commands.command(({ tr, state }) => {
    tr.insert(0, state.schema.nodes.paragraph.create(null, state.schema.text(value)));
    tr.setMeta('addToHistory', false);
    return true;
  });
}

function replaceRoot() {
  const content = editor.getJSON();
  editor.destroy();
  mount = remount(mount);
  editor = createEditor(content);
  return host();
}

expose({
  column,
  variant,
  library,
  host,
  text: () => modelText(editor.state.doc),
  seeds,
  typingBlock,
  notChecked: () => elementsNotChecked(host()),
  neverFlag: () => [...host().querySelectorAll('span[data-type=mention]'), ...inlineCode(host())],
  decoys: () => [{ name: 'hidden disabled textarea#static-composer-input', element: decoyTextarea, poke: 'none' }],
  bold,
  remoteEdit,
  replaceRoot,
  scroller: () => scroller,
  otherScroller: () => otherScroller,
});
