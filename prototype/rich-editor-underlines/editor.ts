// PROTOTYPE (#57), throwaway. "The site": a stock ProseMirror editor plus buttons that re-render it the ways real sites do.
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DOMParser, Schema } from 'prosemirror-model';
import { schema as basic } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { exampleSetup } from 'prosemirror-example-setup';

const schema = new Schema({ nodes: addListNodes(basic.spec.nodes, 'paragraph block*', 'block'), marks: basic.spec.marks });

const START = `
<p>Hi team, I wanted to share a quick update on teh launch plan. We will recieve the final assets on Friday.</p>
<p>The speling of the product name is still open, and they was going to confirm it <em>by Monday</em>.</p>
<ul><li><p>In order to ship on time we need the copy frozen.</p></li><li><p>The <strong>landing page</strong> mentions a kucing in the hero image.</p></li></ul>
<blockquote><p>Quoted: definately the best option we have.</p></blockquote>
<p>Filler paragraph so the editor scrolls. Filler paragraph so the editor scrolls.</p>
<p>Another filler line, with a misteak near the bottom of the scroll area.</p>
<p>Last line down here to make the box overflow.</p>`;

const mount = document.getElementById('mount')!;
let view = makeView(EditorState.create({ doc: parse(START), plugins: exampleSetup({ schema, menuBar: false }) }));

function parse(html: string) {
  const el = document.createElement('div');
  el.innerHTML = html;
  return DOMParser.fromSchema(schema).parse(el);
}

function makeView(state: EditorState) {
  return new EditorView(mount, { state });
}

function findWord(word: string): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (hit || !node.isText) return;
    const i = node.text!.indexOf(word);
    if (i >= 0) hit = { from: pos + i, to: pos + i + word.length };
  });
  return hit;
}

document.getElementById('bold')!.onclick = () => {
  const hit = findWord('speling');
  if (hit) view.dispatch(view.state.tr.addMark(hit.from, hit.to, schema.marks.strong.create()));
};

// A collaborator's edit landing elsewhere in the doc, as Google Docs / Slack threads do.
document.getElementById('remote')!.onclick = () => {
  view.dispatch(view.state.tr.insertText('[remote] ', 1));
};

// Same content, new EditorState: ProseMirror may keep or redraw nodes.
document.getElementById('setdoc')!.onclick = () => {
  const doc = parse(view.dom.innerHTML);
  view.updateState(EditorState.create({ doc, plugins: view.state.plugins }));
};

// Worst case: the editable root itself is thrown away and replaced.
document.getElementById('recreate')!.onclick = () => {
  const state = view.state;
  view.destroy();
  view = makeView(state);
};

// A long Gmail-thread-sized doc: the start text 100 times over (~50k chars, ~800 Slips).
document.getElementById('long')!.onclick = () => {
  view.updateState(EditorState.create({ doc: parse(START.repeat(100)), plugins: view.state.plugins }));
};

// One keystroke's worth of edit in the middle of the doc.
document.getElementById('type')!.onclick = () => {
  view.dispatch(view.state.tr.insertText('x', Math.floor(view.state.doc.content.size / 2)));
};

document.getElementById('clear')!.onclick = () => CSS.highlights.clear();

const spell = document.getElementById('spell') as HTMLInputElement;
const syncSpell = () => view.dom.setAttribute('spellcheck', String(spell.checked));
spell.onchange = syncSpell;
syncSpell();

(window as any).pm = () => view;
