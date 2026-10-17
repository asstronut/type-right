// Runs in the content script's ISOLATED world. Results go to <html data-probe-*> so the driver can read them.
const out = (key, value) => { document.documentElement.dataset['probe' + key] = JSON.stringify(value); };
const names = new Map();
const kinds = ['spelling', 'grammar', 'wording', 'translation'];

const p1 = document.getElementById('p1');
const t1 = p1.firstChild;
const b = p1.querySelector('b');
let t2 = p1.childNodes[2];
const word = (node, w) => { const i = node.data.indexOf(w); const r = new Range(); r.setStart(node, i); r.setEnd(node, i + w.length); return r; };

const ranges = {
  spelling: word(t1, 'Thiss'),
  grammar: (() => { const r = new Range(); r.setStart(t1, t1.data.indexOf('sentense')); r.setEnd(b.firstChild, 4); return r; })(),
  wording: word(t2, 'wordy wording'),
  translation: word(t2, 'kucing'),
};
const shadowRoot = document.getElementById('host').shadowRoot;
const inner = shadowRoot.getElementById('inner').firstChild;
const far = document.getElementById('far').firstChild;
const spell = document.getElementById('spell').firstChild;

const highlights = {};
for (const k of kinds) {
  highlights[k] = new Highlight();
  CSS.highlights.set('tr-' + k, highlights[k]);
  names.set(highlights[k], 'tr-' + k);
}
for (const k of kinds) highlights[k].add(ranges[k]);
highlights.spelling.add(word(inner, 'Shadoww'));
highlights.spelling.add(word(far, 'mispeled'));
highlights.translation.add(word(spell, 'tesst'));

const describe = (hits) => hits.map((h) => ({ name: names.get(h.highlight) ?? '(foreign)', ranges: h.ranges.map((r) => `${r.constructor.name}:${r instanceof Range ? JSON.stringify(r.toString()) : ''}`) }));
const hitAt = (x, y, opts) => describe(CSS.highlights.highlightsFromPoint(x, y, opts));

function hitTests() {
  const res = {};
  for (const k of kinds) {
    const rect = ranges[k].getClientRects()[0];
    res[k] = {
      rect: [rect.left, rect.top, rect.width, rect.height].map(Math.round),
      center: hitAt(rect.left + rect.width / 2, rect.top + rect.height / 2),
      belowGlyphs2px: hitAt(rect.left + rect.width / 2, rect.bottom + 2),
      bottomEdgeMinus1: hitAt(rect.left + rect.width / 2, rect.bottom - 1),
    };
  }
  const sr = word(inner, 'Shadoww').getBoundingClientRect();
  res.shadowWithoutOption = hitAt(sr.left + 5, sr.top + sr.height / 2);
  res.shadowWithOption = hitAt(sr.left + 5, sr.top + sr.height / 2, { shadowRoots: [shadowRoot] });
  const fr = word(far, 'mispeled').getBoundingClientRect();
  res.farScrolledOutRect = [fr.left, fr.top, fr.width, fr.height].map(Math.round);
  res.farScrolledOut = hitAt(fr.left + 5, fr.top + fr.height / 2);
  res.typeofHighlight = typeof Highlight;
  const cs = (el) => { const s = getComputedStyle(el, '::highlight(tr-spelling)'); return `${s.textDecorationLine} ${s.textDecorationStyle} ${s.textDecorationColor} ${s.textDecorationThickness} offset=${s.textUnderlineOffset}`; };
  res.computedInDocument = cs(p1);
  res.computedInShadow = cs(shadowRoot.getElementById('inner'));
  res.registrySizeIsolated = CSS.highlights.size;
  return res;
}
out('Initial', hitTests());

try {
  const ta = document.getElementById('ta');
  const i = ta.value.indexOf('speling');
  const vr = ta.createValueRange(i, i + 7);
  highlights.spelling.add(vr);
  const rects = vr.getClientRects();
  const r = rects[0];
  out('Opaque', {
    ctor: vr.constructor.name, startOffset: vr.startOffset, endOffset: vr.endOffset, startContainer: String(vr.startContainer),
    rect: r ? [r.left, r.top, r.width, r.height].map(Math.round) : null,
    hit: r ? hitAt(r.left + r.width / 2, r.top + r.height / 2) : null,
  });
  ta.addEventListener('input', () => out('OpaqueAfterTyping', { start: vr.startOffset, end: vr.endOffset, text: ta.value.slice(vr.startOffset, vr.endOffset) }));
} catch (e) {
  out('Opaque', { error: String(e) });
}

document.getElementById('ed').addEventListener('mousemove', (e) => {
  out('Mouse', { x: e.clientX, y: e.clientY, hits: hitAt(e.clientX, e.clientY) });
});

const snap = (r) => ({ collapsed: r.collapsed, start: r.startContainer.nodeName + ':' + r.startOffset, end: r.endContainer.nodeName + ':' + r.endOffset, text: r.toString() });

document.addEventListener('probe-step', (e) => {
  const step = e.detail;
  if (step === 'mutate') {
    const res = {};
    // a) editor inserts text before the Slip in the same node (normal typing)
    t2.insertData(0, 'XX');
    res.afterInsertBefore = snap(ranges.wording);
    // b) editor rewrites the whole text node's data with identical text
    t1.data = t1.data;
    res.afterSameDataRewrite_spelling = snap(ranges.spelling);
    res.afterSameDataRewrite_grammarStart = snap(ranges.grammar);
    // c) editor replaces the text node with a fresh one (React/Lexical-style re-render)
    const fresh = new Text(t2.data);
    t2.replaceWith(fresh);
    res.afterNodeReplace_translation = snap(ranges.translation);
    // d) a StaticRange over a node that then gets removed
    const sr = new StaticRange({ startContainer: fresh, startOffset: 0, endContainer: fresh, endOffset: 2 });
    const tmp = new Text('gone');
    p1.appendChild(tmp);
    const srGone = new StaticRange({ startContainer: tmp, startOffset: 0, endContainer: tmp, endOffset: 4 });
    tmp.remove();
    res.staticRangeOnRemovedNode = { collapsed: srGone.collapsed, startContainerConnected: srGone.startContainer.isConnected };
    t2 = fresh;
    out('Mutate', res);
  }
  if (step === 'rebuild') {
    // Rebuild every highlight from offsets, as Type Right would after each edit.
    const t1n = p1.firstChild;
    const fresh = p1.childNodes[2];
    const mk = (node, w) => { const i = node.data.indexOf(w); return new StaticRange({ startContainer: node, startOffset: i, endContainer: node, endOffset: i + w.length }); };
    highlights.spelling.clear(); highlights.spelling.add(mk(t1n, 'Thiss'));
    highlights.spelling.add(mk(inner, 'Shadoww'));
    highlights.spelling.add(mk(far, 'mispeled'));
    highlights.grammar.clear(); highlights.grammar.add(mk(t1n, 'sentense'));
    highlights.wording.clear(); highlights.wording.add(mk(fresh, 'wordy wording'));
    highlights.translation.clear(); highlights.translation.add(mk(fresh, 'kucing'));
    highlights.translation.add(mk(spell, 'tesst'));
    const rect = new Range(); rect.setStart(fresh, fresh.data.indexOf('kucing')); rect.setEnd(fresh, fresh.data.indexOf('kucing') + 6);
    const r = rect.getBoundingClientRect();
    out('Rebuild', { kucingHit: hitAt(r.left + 4, r.top + r.height / 2) });
  }
  if (step === 'shadowstyle') {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('::highlight(tr-spelling) { text-decoration: underline wavy #e11d48 2px; text-underline-offset: 3px; }');
    shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
    out('Shadowstyle', { adopted: shadowRoot.adoptedStyleSheets.length });
  }
  if (step === 'scroll') {
    const fr = new Range(); fr.selectNodeContents(document.getElementById('far').firstChild);
    const rr = fr.getBoundingClientRect();
    out('Scroll', { rect: [rr.left, rr.top, rr.width, rr.height].map(Math.round), hit: hitAt(rr.left + 10, rr.top + rr.height / 2) });
  }
  if (step === 'bench') {
    const ed = document.createElement('div');
    ed.contentEditable = 'true';
    ed.style.cssText = 'width:700px;font:16px/1.5 system-ui';
    const words = [];
    for (let i = 0; i < 4000; i++) words.push('word' + (i % 97));
    ed.textContent = words.join(' ');
    document.body.appendChild(ed);
    const tn = ed.firstChild;
    const rs = [];
    for (let i = 0; i < 200; i++) { const r = new Range(); const off = i * 100; r.setStart(tn, off); r.setEnd(tn, off + 6); rs.push(r); }
    ed.getBoundingClientRect();
    let t = performance.now();
    for (let rep = 0; rep < 10; rep++) for (const r of rs) r.getClientRects();
    const cleanPerRange = (performance.now() - t) / 2000;
    const dirty = [];
    for (let rep = 0; rep < 10; rep++) {
      ed.style.width = (700 - rep) + 'px';
      t = performance.now();
      for (const r of rs) r.getClientRects();
      dirty.push(performance.now() - t);
    }
    const hl = new Highlight(...rs.map((r) => new StaticRange({ startContainer: r.startContainer, startOffset: r.startOffset, endContainer: r.endContainer, endOffset: r.endOffset })));
    t = performance.now();
    CSS.highlights.set('tr-bench', hl);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const setAndPaint = performance.now() - t;
      out('Bench', { cleanPerRangeMs: cleanPerRange, dirty200RangesMs: dirty.map((d) => +d.toFixed(2)), highlightSet200ThenTwoFramesMs: +setAndPaint.toFixed(2) });
    }));
  }
  if (step === 'afterpageclear') {
    out('Afterpageclear', { registrySizeIsolated: CSS.highlights.size });
  }
});
out('Ready', true);
