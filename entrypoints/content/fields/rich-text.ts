import type { FieldRead } from './field';
import type { TextSpan } from '../../../lib/slip-tracker';

interface Segment {
  node: Text;
  nodeStart: number;
  start: number;
  end: number;
  data: string;
}

export interface RichTextReader {
  read(changes: readonly MutationRecord[]): Omit<FieldRead, 'composing'>;
}

export interface RegionRules {
  notChecked: readonly string[];
  trailing: readonly string[];
  neverFlag: readonly string[];
  skip: readonly string[];
}

export const REGION_RULES: RegionRules = {
  notChecked: ['pre', 'blockquote', '.ql-code-block'],
  // #73: regions the editor appends after the typed text. Also not checked, and they add no line at the end.
  trailing: ['.gmail_signature', '.gmail_signature_prefix', '.gmail_quote'],
  neverFlag: ['code', 'ts-mention', '[data-type="mention"]', '[contenteditable="false"]', 'img.emoji', 'img[data-emoji]'],
  // #73: Gmail's Smart Compose suggestion sits inline in the caret's line. It is left out of the text entirely.
  skip: ['span.XjviVd[contenteditable="false"]'],
};

interface Regions {
  notChecked: string;
  trailing: string;
  neverFlag: string;
  skip: string;
}

type Blocks = WeakMap<Element, Line[]>;

export function createRichTextReader(host: HTMLElement, regionRules: RegionRules = REGION_RULES): RichTextReader {
  const regions = {
    notChecked: [...regionRules.notChecked, ...regionRules.trailing].join(','),
    trailing: regionRules.trailing.join(','),
    neverFlag: regionRules.neverFlag.join(','),
    skip: regionRules.skip.join(','),
  };
  const blocks: Blocks = new WeakMap();
  return {
    read(changes) {
      for (const change of changes) forgetChanged(host, blocks, change);
      const { text, segments, neverFlag } = layOut(endAtLastCheckedLine(linesOf(host, regions, blocks)));
      return { text, neverFlag, rangeFor: (span) => rangeOver(host, segments, span) };
    },
  };
}

interface Piece {
  node: Text | null;
  nodeStart: number;
  text: string;
  neverFlag: boolean;
}

type Line = Piece[];

const standIns = new WeakSet<Line>();
const trailingStandIns = new WeakSet<Line>();

type Item = { kind: 'block'; lines: Line[] } | { kind: 'run'; lines: Line[]; isGap: boolean };

interface Run {
  lines: Line[];
  current: Line;
  hasBreak: boolean;
  endsWithBreak: boolean;
}

type Role = 'skip' | 'block' | 'inline' | 'br' | 'region' | 'chip';

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'ul',
]);

const SKIPPED_TAGS = new Set([
  'script', 'style', 'template', 'noscript', 'img', 'svg', 'math', 'canvas', 'video', 'audio', 'object', 'iframe',
  'select', 'textarea',
]);

const matches = (element: Element, selectors: string): boolean => selectors !== '' && element.matches(selectors);

function classify(element: Element, regions: Regions): Role {
  if (
    element.hasAttribute('hidden') ||
    element.getAttribute('aria-hidden') === 'true' ||
    element.hasAttribute('data-slate-placeholder') ||
    (element instanceof HTMLElement && element.style.display === 'none') ||
    matches(element, regions.skip)
  ) {
    return 'skip';
  }
  if (matches(element, regions.notChecked)) return 'region';
  const isBlock = BLOCK_TAGS.has(element.localName);
  if (!isBlock && matches(element, regions.neverFlag)) return 'chip';
  if (SKIPPED_TAGS.has(element.localName)) return 'skip';
  if (element.localName === 'br') return 'br';
  return isBlock ? 'block' : 'inline';
}

const SINGLE_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/u;
const OBJECT_REPLACEMENT = String.fromCharCode(0xfffc);

function emojiOf(image: Element): string {
  const alt = image.getAttribute('alt')?.trim() ?? '';
  const graphemes = [...new Intl.Segmenter().segment(alt)];
  return graphemes.length === 1 && SINGLE_EMOJI.test(alt) ? alt : OBJECT_REPLACEMENT;
}

function labelOf(chip: Element, regions: Regions): Piece[] {
  if (chip.localName === 'img') return [{ node: null, nodeStart: 0, text: emojiOf(chip), neverFlag: true }];
  const pieces: Piece[] = [];
  for (const child of chip.childNodes) {
    if (child instanceof Text) {
      for (const piece of piecesOf(child)) {
        if (piece.text.trim()) pieces.push({ ...piece, text: piece.text.replace(/\s/g, ' '), neverFlag: true });
      }
    } else if (child instanceof Element) {
      const role = classify(child, regions);
      if (role === 'block' || role === 'inline' || role === 'chip') pieces.push(...labelOf(child, regions));
    }
  }
  return pieces;
}

const TYPED_CHARACTERS = /[^\u200b\ufeff\u2060]+/g;

function piecesOf(node: Text): Piece[] {
  return [...node.data.matchAll(TYPED_CHARACTERS)].map((match) => ({
    node,
    nodeStart: match.index,
    text: match[0].replace(/\u00a0/g, ' '),
    neverFlag: false,
  }));
}

const textOf = (line: Line): string => line.map((piece) => piece.text).join('');

function forgetChanged(host: HTMLElement, blocks: Blocks, change: MutationRecord): void {
  for (let node: Node | null = change.target; node && node !== host.parentNode; node = node.parentNode) {
    if (node instanceof Element) blocks.delete(node);
  }
  // A node can change while it is out of the editor, where no mutation is seen, and then come back.
  for (const added of change.addedNodes) {
    if (!(added instanceof Element)) continue;
    blocks.delete(added);
    for (const inside of added.querySelectorAll('*')) blocks.delete(inside);
  }
}

function linesOf(block: Element, regions: Regions, blocks: Blocks): Line[] {
  const known = blocks.get(block);
  if (known) return known;
  const items = itemsOf(block, regions, blocks);
  const hasChildBlocks = items.some((item) => item.kind === 'block');
  const lines = items.flatMap((item) => (item.kind === 'run' && item.isGap && hasChildBlocks ? [] : item.lines));
  const read = lines.length ? lines : [[]];
  blocks.set(block, read);
  return read;
}

function itemsOf(block: Element, regions: Regions, blocks: Blocks): Item[] {
  const items: Item[] = [];
  let run: Run | undefined;

  function endRun(): void {
    if (run) items.push(finishRun(run));
    run = undefined;
  }

  function visit(parent: Node): void {
    for (const child of parent.childNodes) {
      if (child instanceof Text) {
        const pieces = piecesOf(child);
        if (!pieces.length) continue;
        run ??= startRun();
        run.current.push(...pieces);
        run.endsWithBreak = false;
      } else if (child instanceof Element) {
        const known = blocks.get(child);
        if (known) {
          endRun();
          items.push({ kind: 'block', lines: known });
          continue;
        }
        switch (classify(child, regions)) {
          case 'skip':
            break;
          case 'region': {
            endRun();
            const lines = [standIn(matches(child, regions.trailing))];
            blocks.set(child, lines);
            items.push({ kind: 'block', lines });
            break;
          }
          case 'chip': {
            const label = labelOf(child, regions);
            if (!label.length) break;
            run ??= startRun();
            run.current.push(...label);
            run.endsWithBreak = false;
            break;
          }
          case 'br':
            run ??= startRun();
            breakLine(run);
            break;
          case 'inline':
            visit(child);
            break;
          case 'block':
            endRun();
            items.push({ kind: 'block', lines: linesOf(child, regions, blocks) });
            break;
        }
      }
    }
  }

  visit(block);
  endRun();
  return items;
}

function standIn(trailing: boolean): Line {
  const line: Line = [];
  standIns.add(line);
  if (trailing) trailingStandIns.add(line);
  return line;
}

function endAtLastCheckedLine(lines: Line[]): Line[] {
  if (!trailingStandIns.has(lines.at(-1) ?? [])) return lines;
  let end = lines.length;
  const dropsOff = (line: Line): boolean =>
    trailingStandIns.has(line) || (!standIns.has(line) && textOf(line).trim() === '');
  while (end > 1 && dropsOff(lines[end - 1]!)) end--;
  return lines.slice(0, end);
}

function startRun(): Run {
  const current: Line = [];
  return { lines: [current], current, hasBreak: false, endsWithBreak: false };
}

function breakLine(run: Run): void {
  run.current = [];
  run.lines.push(run.current);
  run.hasBreak = true;
  run.endsWithBreak = true;
}

function finishRun(run: Run): Item {
  if (run.endsWithBreak && run.lines.length > 1) run.lines.pop();
  return { kind: 'run', lines: run.lines, isGap: !run.hasBreak && /^\s*$/.test(textOf(run.current)) };
}

function layOut(lines: Line[]): { text: string; segments: Segment[]; neverFlag: TextSpan[] } {
  const segments: Segment[] = [];
  const neverFlag: TextSpan[] = [];
  let text = '';
  lines.forEach((line, index) => {
    if (index) text += '\n';
    for (const { node, nodeStart, text: run, neverFlag: flagged } of line) {
      const start = text.length;
      if (node) segments.push({ node, nodeStart, start, end: start + run.length, data: node.data });
      if (flagged) {
        const last = neverFlag.at(-1);
        if (last?.end === start) last.end += run.length;
        else neverFlag.push({ start, end: start + run.length });
      }
      text += run;
    }
  });
  return { text, segments, neverFlag };
}

interface Point {
  node: Node;
  offset: number;
  segment?: Segment;
}

function pointAt(host: HTMLElement, segments: Segment[], offset: number, side: 'start' | 'end'): Point {
  const limit = side === 'start' ? offset + 1 : offset;
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const probe = segments[middle];
    if (probe && probe.start < limit) low = middle + 1;
    else high = middle;
  }
  const segment = segments[low - 1] ?? segments[0];
  if (!segment) return { node: host, offset: 0 };
  const inside = Math.min(Math.max(offset, segment.start), segment.end) - segment.start;
  return { node: segment.node, offset: segment.nodeStart + inside, segment };
}

function rangeOver(host: HTMLElement, segments: Segment[], span: TextSpan): StaticRange {
  const start = pointAt(host, segments, span.start, 'start');
  const end = pointAt(host, segments, span.end, 'end');
  if (!isUnchanged(host, start) || !isUnchanged(host, end)) {
    return new StaticRange({ startContainer: host, startOffset: 0, endContainer: host, endOffset: 0 });
  }
  return new StaticRange({
    startContainer: start.node,
    startOffset: start.offset,
    endContainer: end.node,
    endOffset: end.offset,
  });
}

function isUnchanged(host: HTMLElement, { segment }: Point): boolean {
  return !segment || (host.contains(segment.node) && segment.node.data === segment.data);
}
