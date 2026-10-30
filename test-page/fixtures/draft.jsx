import { CompositeDecorator, Editor, EditorState, Modifier, RichUtils, SelectionState, convertFromRaw } from 'draft-js';
import 'draft-js/dist/Draft.css';
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expose } from './fixture.js';
import { buildPage, check, el, getVariant, remount, tallerThanScroller, textboxAttributes } from './layout.js';
import { hasStubWord } from './prose.js';

const { column, library } = __FIXTURE__;
const variant = getVariant();
const page = buildPage(column);
const { scroller, otherScroller, slot } = page;
let mount = page.mount;

const TESTID = 'tweetTextarea_0';

function findRegex(regex, block, callback) {
  const text = block.getText();
  for (let match = regex.exec(text); match; match = regex.exec(text)) {
    callback(match.index, match.index + match[0].length);
  }
}

const decorator = new CompositeDecorator([
  {
    strategy: (block, callback) => findRegex(/@\w+/g, block, callback),
    component: ({ children }) => <span style={{ color: 'rgb(29, 155, 240)' }}>{children}</span>,
  },
  {
    strategy: (block, callback) => findRegex(/`[^`\n]+`/g, block, callback),
    component: ({ children }) => <code>{children}</code>,
  },
]);

const rawBlock = (key, type, text) => ({ key, type, text, depth: 0, inlineStyleRanges: [], entityRanges: [], data: {} });

const seededRaw = {
  entityMap: {},
  blocks: [
    rawBlock('intro', 'unstyled', 'Reminder for @team: the deadline for the survey is tomorrow. I ran `refresh_all.py` to refresh the totals.'),
    rawBlock('headers', 'unstyled', 'Do not edit the headers. Fill in every column and read the notes in the sheet before you send it back.'),
    rawBlock('code', 'code-block', 'if (answers.adress) {\n  save(answers);\n}'),
    rawBlock('quote', 'blockquote', 'Our manager wrote: please send the files to the new adress by noon and confirm.'),
    rawBlock('gap', 'unstyled', ''),
    rawBlock('typing', 'unstyled', 'Our manager wrote "late submissions will not be accepted" in the last email. You can upload the file here: https://example.com/upload. Please be carefull'),
  ],
};

function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(next) {
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function Composer({ store }) {
  const editorState = useSyncExternalStore(store.subscribe, store.get);
  const handleKeyCommand = (command, current) => {
    const next = RichUtils.handleKeyCommand(current, command);
    if (!next) return 'not-handled';
    store.set(next);
    return 'handled';
  };
  return (
    <Editor
      editorState={editorState}
      onChange={store.set}
      handleKeyCommand={handleKeyCommand}
      spellCheck
      ariaMultiline
      ariaLabel="Post text"
      webDriverTestID={TESTID}
    />
  );
}

function mountComposer(container, content) {
  const store = createStore(EditorState.createWithContent(content, decorator));
  const root = createRoot(container);
  flushSync(() => root.render(<Composer store={store} />));
  return { store, root };
}

const composerHost = (container) => container.querySelector('.public-DraftEditor-content');

const duplicateMount = el('div', { id: 'duplicate-mount' });
slot.prepend(el('section', { class: 'timeline-composer' }, el('div', { class: 'timeline-label', text: 'Home timeline composer' }), duplicateMount));
const duplicate = mountComposer(duplicateMount, convertFromRaw({ entityMap: {}, blocks: [rawBlock('dup', 'unstyled', 'a dekoy post')] }));

const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Compose post', id: 'compose-dialog' }, scroller);
dialog.style.cssText =
  'position: fixed; top: 300px; left: 50%; margin-left: -280px; width: 560px; box-sizing: border-box; padding: 12px; background: #fff; border: 1px solid #888; border-radius: 12px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25); z-index: 10;';
document.body.append(dialog);
document.head.append(
  el('style', {
    text: `
      .timeline-composer { border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; }
      .timeline-label { font-size: 12px; color: #666; }
      .public-DraftEditor-content { outline: none; }
      .DraftEditor-root { position: relative; }
    `,
  }),
);

let main = mountComposer(mount, convertFromRaw(seededRaw));

const host = () => composerHost(mount);
const typingBlock = () => host().querySelector('[data-contents] > :last-child');
const content = () => main.store.get().getCurrentContent();
const SKIPPED_TYPES = ['code-block', 'blockquote'];

function seeds() {
  const root = host();
  const pre = root.querySelector('pre');
  const quote = root.querySelector('blockquote');
  const handle = [...root.querySelectorAll('span[style]')].find((span) => span.textContent === '@team');
  const code = [...root.querySelectorAll('code')].find((element) => element.textContent === '`refresh_all.py`');
  const dup = composerHost(duplicateMount);
  const block = typingBlock();
  return [
    textboxAttributes(root),
    check('root is div.public-DraftEditor-content', root.matches('div.public-DraftEditor-content[role=textbox]') && root.getAttribute('data-testid') === TESTID, root.className),
    check('@team as styled text', handle?.style.color === 'rgb(29, 155, 240)' && !handle.closest('code'), handle?.outerHTML),
    check('backtick text inside code', Boolean(code), 'code'),
    check('code block', pre?.textContent.includes('adress'), 'pre'),
    check('blockquote', quote?.textContent.includes('adress'), 'blockquote'),
    check('typing block after the seeded regions', hasStubWord(block.textContent), block.textContent),
    check(
      'decoy: duplicate composer',
      dup && dup !== root && dup.getAttribute('data-testid') === TESTID && dup.textContent.includes('a dekoy post') && dup.getBoundingClientRect().height > 0 && !dialog.contains(dup),
      'second Draft editor, same data-testid, visible outside the dialog',
    ),
    check('dialog overlay open', dialog.getAttribute('role') === 'dialog' && dialog.contains(root) && getComputedStyle(dialog).position === 'fixed', 'div[role=dialog]'),
    tallerThanScroller(root, scroller),
  ];
}

function bold(word) {
  const current = main.store.get();
  const blocks = content().getBlocksAsArray();
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (SKIPPED_TYPES.includes(block.getType())) continue;
    const index = block.getText().lastIndexOf(word);
    if (index < 0) continue;
    const range = SelectionState.createEmpty(block.getKey()).merge({ anchorOffset: index, focusOffset: index + word.length });
    const styled = Modifier.applyInlineStyle(content(), range, 'BOLD').merge({ selectionAfter: current.getSelection() });
    flushSync(() => main.store.set(EditorState.push(current, styled, 'change-inline-style')));
    return;
  }
  throw new Error(`"${word}" is not in the document outside its code blocks and quotes`);
}

function remoteEdit(text) {
  const current = main.store.get();
  const incoming = convertFromRaw({ entityMap: {}, blocks: [rawBlock(`remote-${Date.now()}`, 'unstyled', text)] });
  const blockMap = incoming.getBlockMap().concat(content().getBlockMap());
  flushSync(() => main.store.set(EditorState.set(current, { currentContent: content().merge({ blockMap }) })));
}

function replaceRoot() {
  const kept = content();
  flushSync(() => main.root.unmount());
  mount = remount(mount);
  main = mountComposer(mount, kept);
  return host();
}

expose({
  column,
  variant,
  library,
  host,
  text: () => content().getPlainText('\n'),
  seeds,
  typingBlock,
  notChecked: () => [...host().querySelectorAll('pre, blockquote')].filter((region) => !region.parentElement.closest('pre, blockquote')),
  neverFlag: () => [...host().querySelectorAll('code')],
  decoys: () => [{ name: 'duplicate composer behind the dialog', element: composerHost(duplicateMount), poke: 'none' }],
  bold,
  remoteEdit,
  replaceRoot,
  scroller: () => scroller,
  otherScroller: () => otherScroller,
});
