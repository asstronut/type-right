// PROTOTYPE (#57), throwaway. "Type Right": editor-blind. It only gets a contenteditable root, reads its text,
// follows edits with the real SlipTracker, and paints Slips with the CSS Custom Highlight API.
// It never writes to the editor's DOM and never calls ProseMirror.
import { createSlipTracker, type TextSpan } from '../../lib/slip-tracker';
import { makeSlipId, SLIP_KINDS, type Slip, type SlipKind } from '../../lib/slips';

// ---------- text model: DOM -> string + text-node segments ----------

const BLOCK = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|UL|OL|TABLE|TR|TD|TH)$/;
interface Segment { node: Text; start: number; end: number }
interface Model { text: string; segments: Segment[] }

function readModel(root: HTMLElement): Model {
  let text = '';
  const segments: Segment[] = [];
  const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  const walk = (parent: Node) => {
    for (const child of parent.childNodes) {
      if (child instanceof Text) {
        segments.push({ node: child, start: text.length, end: text.length + child.data.length });
        text += child.data;
      } else if (child instanceof HTMLElement) {
        // A <br> that only props open an empty or trailing block line adds nothing.
        if (child.tagName === 'BR') { if (child.nextSibling) text += '\n'; continue; }
        const block = BLOCK.test(child.tagName);
        if (block) newline();
        walk(child);
        if (block) newline();
      }
    }
  };
  walk(root);
  return { text, segments };
}

// First segment whose end passes `offset` (strictly for a start, inclusively for an end).
function segmentAt(segments: Segment[], offset: number, isEnd: boolean): Segment | undefined {
  let lo = 0, hi = segments.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (isEnd ? segments[mid].end < offset : segments[mid].end <= offset) lo = mid + 1; else hi = mid; }
  const s = segments[lo];
  return s && (isEnd ? offset > s.start : offset >= s.start) ? s : undefined;
}

function toRange(model: Model, slip: Slip): StaticRange | null {
  const start = segmentAt(model.segments, slip.start, false);
  const end = segmentAt(model.segments, slip.end, true);
  if (!start || !end) return null;
  return new StaticRange({ startContainer: start.node, startOffset: slip.start - start.start, endContainer: end.node, endOffset: slip.end - end.start });
}

const live = (r: AbstractRange) => { const l = document.createRange(); l.setStart(r.startContainer, r.startOffset); l.setEnd(r.endContainer, r.endOffset); return l; };

// ---------- fake Engine: hard-coded rules standing in for LanguageTool ----------

const RULES: { re: RegExp; kind: SlipKind; fix: (m: string) => string; why: string }[] = [
  ...Object.entries({ teh: 'the', recieve: 'receive', speling: 'spelling', definately: 'definitely', misteak: 'mistake' })
    .map(([bad, good]) => ({ re: new RegExp(`\\b${bad}\\b`, 'gi'), kind: 'spelling' as const, fix: () => good, why: 'Possible spelling mistake.' })),
  { re: /\bthey was\b/gi, kind: 'grammar', fix: () => 'they were', why: '"They" takes "were".' },
  { re: /\bin order to\b/gi, kind: 'wording', fix: (m) => (m[0] === 'I' ? 'To' : 'to'), why: 'Shorter says the same.' },
  { re: /\bkucing\b/gi, kind: 'translation', fix: () => 'cat', why: 'Indonesian word in English text.' },
];

function check(text: string): Slip[] {
  const found: Slip[] = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      found.push({ id: makeSlipId(rule.kind, m[0]), start: m.index!, end: m.index! + m[0].length, kind: rule.kind, type: rule.kind, explanation: rule.why, suggestions: [rule.fix(m[0])], source: 'languagetool' });
    }
  }
  return found;
}

// ---------- state ----------

const tracker = createSlipTracker();
let root = findRoot();
let model = readModel(root);
const stats = { mutationBatches: 0, renders: 0, lastRenderMs: 0, maxRenderMs: 0, checks: 0, reRegistrations: 0, rootSwaps: 0, missingRanges: 0, lastReadMs: 0, textLength: 0 };

const highlights = Object.fromEntries(SLIP_KINDS.map((k) => [k, new Highlight()])) as Record<SlipKind, Highlight>;
const hoverHighlight = new Highlight();
hoverHighlight.priority = -1;
const rangeSlip = new Map<AbstractRange, Slip>();

function findRoot(): HTMLElement {
  return document.querySelector<HTMLElement>('[contenteditable="true"]')!;
}

function ensureRegistered() {
  for (const k of SLIP_KINDS) {
    if (CSS.highlights.get(`tr-${k}`) !== highlights[k]) { CSS.highlights.set(`tr-${k}`, highlights[k]); stats.reRegistrations++; }
  }
  if (CSS.highlights.get('tr-hover') !== hoverHighlight) CSS.highlights.set('tr-hover', hoverHighlight);
}

// Rebuild every range from offsets: never trust a range from the last render, the editor may have replaced its nodes.
function render() {
  const t0 = performance.now();
  ensureRegistered();
  for (const k of SLIP_KINDS) highlights[k].clear();
  rangeSlip.clear();
  for (const slip of tracker.slips()) {
    const r = toRange(model, slip);
    if (!r) { stats.missingRanges++; continue; }
    highlights[slip.kind].add(r);
    rangeSlip.set(r, slip);
  }
  const ms = performance.now() - t0;
  stats.renders++;
  stats.lastRenderMs = +ms.toFixed(3);
  stats.maxRenderMs = Math.max(stats.maxRenderMs, stats.lastRenderMs);
  refreshCard();
  showState();
}

// ---------- following edits ----------

let checkTimer = 0;
function onTextMaybeChanged() {
  const t0 = performance.now();
  model = readModel(root);
  stats.lastReadMs = +(performance.now() - t0).toFixed(3);
  stats.textLength = model.text.length;
  if (tracker.applyEdit(model.text)) {
    clearTimeout(checkTimer);
    checkTimer = window.setTimeout(checkDirty, 500);
  }
  render();
}

// The debounced "Engine" pass: re-check the dirty span widened to whole lines.
function checkDirty() {
  const dirty = tracker.dirty();
  if (!dirty) return;
  const text = tracker.text();
  const span: TextSpan = { start: text.lastIndexOf('\n', dirty.start - 1) + 1, end: (text.indexOf('\n', dirty.end) + 1 || text.length + 1) - 1 };
  tracker.replaceSlips('languagetool', span, check(text.slice(span.start, span.end)), { dropTouching: true });
  tracker.clearDirty();
  stats.checks++;
  render();
}

const fieldObserver = new MutationObserver(() => { stats.mutationBatches++; onTextMaybeChanged(); });
const observeField = () => fieldObserver.observe(root, { subtree: true, childList: true, characterData: true });

// The editable root itself can be thrown away (view destroyed and recreated): find the new one.
new MutationObserver(() => {
  if (root.isConnected) return;
  const next = findRoot();
  if (!next) return;
  fieldObserver.disconnect();
  root = next;
  stats.rootSwaps++;
  observeField();
  onTextMaybeChanged();
}).observe(document.body, { subtree: true, childList: true });

// ---------- hover ----------

const card = document.getElementById('tr-card')!;
let hovered: { slip: Slip } | null = null;
let hideTimer = 0;
let mouse = { x: 0, y: 0 };
let raf = 0;

// The hit box is the glyph box; the wavy line sits just below it, so probe a little higher too.
const SLOP = [0, -3, -6];
function slipAt(x: number, y: number): Slip | null {
  for (const dy of SLOP) {
    for (const hit of CSS.highlights.highlightsFromPoint(x, y + dy)) {
      for (const r of hit.ranges) { const s = rangeSlip.get(r); if (s) return s; }
    }
  }
  return null;
}

document.addEventListener('mousemove', (e) => {
  mouse = { x: e.clientX, y: e.clientY };
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; hoverAt(mouse.x, mouse.y); });
});
// The page under a still mouse moves when scrolling, so re-probe then too.
document.addEventListener('scroll', () => { hoverAt(mouse.x, mouse.y); }, true);

function hoverAt(x: number, y: number) {
  ensureRegistered();
  if (card.matches(':hover')) return;
  const slip = slipAt(x, y);
  if (slip) { clearTimeout(hideTimer); show(slip); }
  else if (hovered) { clearTimeout(hideTimer); hideTimer = window.setTimeout(hide, 200); }
}

function currentRange(slip: Slip): AbstractRange | null {
  for (const [r, s] of rangeSlip) if (s.id === slip.id && s.start === slip.start) return r;
  return null;
}

function show(slip: Slip) {
  hovered = { slip };
  card.innerHTML = `<b>${slip.kind}</b>: “${tracker.text().slice(slip.start, slip.end)}” → “${slip.suggestions[0]}”<br><small>${slip.explanation}</small><br><button id="tr-ignore">Ignore here</button>`;
  card.querySelector<HTMLButtonElement>('#tr-ignore')!.onclick = () => { tracker.ignore(slip.id); hide(); render(); };
  card.style.display = 'block';
  refreshCard();
  showState();
}

function hide() {
  hovered = null;
  hoverHighlight.clear();
  card.style.display = 'none';
  showState();
}

// Keep the card under its Slip after edits and scrolls; drop it when the Slip is gone or scrolled out of the field.
function refreshCard() {
  if (!hovered) return;
  const fresh = tracker.slips().find((s) => s.id === hovered!.slip.id);
  const r = fresh && currentRange(fresh);
  if (!fresh || !r) { hide(); return; }
  hovered.slip = fresh;
  hoverHighlight.clear();
  hoverHighlight.add(r);
  const rect = live(r).getBoundingClientRect();
  const box = root.getBoundingClientRect();
  if (rect.bottom < box.top || rect.top > box.bottom) { hide(); return; }
  card.style.left = `${rect.left}px`;
  card.style.top = `${rect.bottom + 6}px`;
}
document.addEventListener('scroll', refreshCard, true);
card.addEventListener('mouseleave', () => { hideTimer = window.setTimeout(hide, 200); });

// ---------- state panel ----------

const statePanel = document.getElementById('state')!;
function showState() {
  const text = tracker.text();
  const slips = tracker.slips();
  let marked = '';
  let at = 0;
  for (const s of slips) { marked += text.slice(at, s.start) + `⟦${s.kind[0].toUpperCase()}:${text.slice(s.start, s.end)}⟧`; at = s.end; }
  marked += text.slice(at);
  const registry = SLIP_KINDS.map((k) => `${k}:${CSS.highlights.get(`tr-${k}`) === highlights[k] ? highlights[k].size : 'MISSING'}`).join(' ');
  statePanel.textContent =
    `stats ${JSON.stringify(stats, null, 1)}\n` +
    `registry ${registry}\n` +
    `dirty ${JSON.stringify(tracker.dirty())}  version ${tracker.version()}\n` +
    `hovered ${hovered ? `${hovered.slip.kind} ${hovered.slip.start}-${hovered.slip.end}` : '-'}\n\n` +
    `slips\n${slips.map((s) => `  ${s.kind.padEnd(11)} ${String(s.start).padStart(4)}-${String(s.end).padEnd(4)} ${JSON.stringify(text.slice(s.start, s.end))}`).join('\n')}\n\n` +
    `text (as the checker sees it)\n${marked}`;
}

tracker.applyEdit(model.text);
tracker.replaceSlips('languagetool', { start: 0, end: model.text.length }, check(model.text));
tracker.clearDirty();
observeField();
render();

(window as any).tr = { stats, tracker, slipAt, model: () => model };

// Driver hook (works across JS worlds and without animation frames): <body data-probe="x,y"> + 'tr-probe' event.
document.addEventListener('tr-probe', () => {
  const [x, y] = document.body.dataset.probe!.split(',').map(Number);
  const slip = slipAt(x, y);
  document.body.dataset.probeResult = slip ? `${slip.kind}:${tracker.text().slice(slip.start, slip.end)}` : '-';
});
