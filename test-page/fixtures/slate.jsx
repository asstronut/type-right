import { Editor, Node, Text, Transforms, createEditor } from 'slate';
import { HistoryEditor, withHistory } from 'slate-history';
import { Editable, Slate, withReact } from 'slate-react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expose } from './fixture.js';
import { buildPage, check, remount, tallerThanScroller, textboxAttributes, getVariant } from './layout.js';
import { FILLER, hasStubWord } from './prose.js';

const { column, library } = __FIXTURE__;
const variant = getVariant();
const page = buildPage(column);
const { scroller, otherScroller } = page;
let mount = page.mount;

const SKIPPED_TYPES = ['code-block', 'block-quote'];
const paragraph = (...children) => ({ type: 'paragraph', children: children.map((child) => (typeof child === 'string' ? { text: child } : child)) });

const seededValue = () => [
  paragraph('Hi team, this is a short note about the weekly report. It is ready for review and the totals are in the sheet.'),
  paragraph(FILLER),
  paragraph('Please check the numbers before noon. ', { type: 'mention', children: [{ text: '' }] }, { text: ' will merge the changes after that.' }),
  { type: 'code-block', children: [{ text: 'if (invoice.recieve) {\n  send(invoice);\n}' }] },
  { type: 'block-quote', children: [{ text: 'Budi wrote: please recieve the files by noon and confirm.' }] },
  paragraph('To refresh the numbers I ran ', { text: 'refresh_all.py', code: true }, ' this morning, then checked the totals twice.'),
  paragraph('There is one seperate task left, so I will definately finish it before the weekend.'),
];

function createSlateEditor() {
  const editor = withHistory(withReact(createEditor()));
  const { isInline, isVoid } = editor;
  editor.isInline = (element) => element.type === 'mention' || isInline(element);
  editor.isVoid = (element) => element.type === 'mention' || isVoid(element);
  return editor;
}

function renderElement({ attributes, children, element }) {
  switch (element.type) {
    case 'code-block':
      return <pre {...attributes}>{children}</pre>;
    case 'block-quote':
      return <blockquote {...attributes}>{children}</blockquote>;
    case 'mention':
      return (
        <span {...attributes} contentEditable={false}>
          @Dana{children}
        </span>
      );
    default:
      return <p {...attributes}>{children}</p>;
  }
}

function renderLeaf({ attributes, children, leaf }) {
  let rendered = children;
  if (leaf.code) rendered = <code>{rendered}</code>;
  if (leaf.bold) rendered = <strong>{rendered}</strong>;
  return <span {...attributes}>{rendered}</span>;
}

function onKeyDown(event, editor) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'b') return;
  event.preventDefault();
  if (Editor.marks(editor)?.bold) Editor.removeMark(editor, 'bold');
  else Editor.addMark(editor, 'bold', true);
}

function SlateEditor({ editor, initialValue }) {
  return (
    <Slate editor={editor} initialValue={initialValue}>
      <Editable
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        spellCheck
        renderElement={renderElement}
        renderLeaf={renderLeaf}
        onKeyDown={(event) => onKeyDown(event, editor)}
      />
    </Slate>
  );
}

function mountEditor(container, initialValue) {
  const editor = createSlateEditor();
  const root = createRoot(container);
  flushSync(() => root.render(<SlateEditor editor={editor} initialValue={initialValue} />));
  return { editor, root };
}

let current = mountEditor(mount, seededValue());

const host = () => mount.querySelector('[data-slate-editor]');
const typingBlock = () => host().lastElementChild;
const blockText = () => current.editor.children.map((node) => Node.string(node));

function seeds() {
  const root = host();
  const chip = root.querySelector('span[contenteditable=false]');
  const pre = root.querySelector('pre');
  const quote = root.querySelector('blockquote');
  const code = [...root.querySelectorAll('code')].find((element) => !element.closest('pre'));
  const block = typingBlock();
  return [
    textboxAttributes(root),
    check('mention as a void inline', chip?.textContent.startsWith('@Dana') && chip.closest('p') && current.editor.isVoid({ type: 'mention' }), chip?.outerHTML),
    check('code block', pre?.textContent.includes('recieve'), 'pre'),
    check('blockquote', quote?.textContent.includes('recieve'), 'blockquote'),
    check('inline code', code?.textContent === 'refresh_all.py', 'code from renderLeaf'),
    check('typing block after the seeded regions', block.tagName === 'P' && hasStubWord(block.textContent), block.textContent),
    tallerThanScroller(root, scroller),
  ];
}

function bold(word) {
  const { editor } = current;
  for (let i = editor.children.length - 1; i >= 0; i -= 1) {
    const block = editor.children[i];
    if (SKIPPED_TYPES.includes(block.type)) continue;
    for (const [leaf, path] of Node.texts(block, { reverse: true })) {
      const index = leaf.text.lastIndexOf(word);
      if (index < 0) continue;
      const at = { path: [i, ...path] };
      Transforms.setNodes(editor, { bold: true }, { at: { anchor: { ...at, offset: index }, focus: { ...at, offset: index + word.length } }, match: Text.isText, split: true });
      return;
    }
  }
  throw new Error(`"${word}" is not in the document outside its code blocks and quotes`);
}

function remoteEdit(text) {
  const { editor } = current;
  HistoryEditor.withoutSaving(editor, () => Transforms.insertNodes(editor, paragraph(text), { at: [0] }));
}

function replaceRoot() {
  const kept = structuredClone(current.editor.children);
  flushSync(() => current.root.unmount());
  mount = remount(mount);
  current = mountEditor(mount, kept);
  return host();
}

expose({
  column,
  variant,
  library,
  host,
  text: () => blockText().join('\n'),
  seeds,
  typingBlock,
  notChecked: () => [...host().querySelectorAll('pre, blockquote')],
  neverFlag: () => [...host().querySelectorAll('span[contenteditable=false]'), ...[...host().querySelectorAll('code')].filter((element) => !element.closest('pre'))],
  decoys: () => [],
  bold,
  remoteEdit,
  replaceRoot,
  scroller: () => scroller,
  otherScroller: () => otherScroller,
});
