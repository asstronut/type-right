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
  read(): Omit<FieldRead, 'composing'>;
}

export interface RegionRules {
  notChecked: readonly string[];
  neverFlag: readonly string[];
}

export const REGION_RULES: RegionRules = {
  notChecked: [
    'pre',
    'blockquote',
    '.ql-code-block',
    // #73: Gmail's signature, the "-- " line before it, and the quoted history of a reply.
    '.gmail_signature',
    '.gmail_signature_prefix',
    '.gmail_quote',
  ],
  neverFlag: ['code', 'ts-mention', '[data-type="mention"]', '[contenteditable="false"]', 'img.emoji', 'img[data-emoji]'],
};

interface Regions {
  notChecked: string;
  neverFlag: string;
}

export function createRichTextReader(host: HTMLElement, regionRules: RegionRules = REGION_RULES): RichTextReader {
  const regions = { notChecked: regionRules.notChecked.join(','), neverFlag: regionRules.neverFlag.join(',') };
  return {
    read() {
      const { text, segments, neverFlag } = layOut(endAtLastCheckedLine(linesOf(host, regions)));
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
    (element instanceof HTMLElement && element.style.display === 'none')
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

function linesOf(block: Element, regions: Regions): Line[] {
  const items = itemsOf(block, regions);
  const hasChildBlocks = items.some((item) => item.kind === 'block');
  const lines = items.flatMap((item) => (item.kind === 'run' && item.isGap && hasChildBlocks ? [] : item.lines));
  return lines.length ? lines : [[]];
}

function itemsOf(block: Element, regions: Regions): Item[] {
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
        switch (classify(child, regions)) {
          case 'skip':
            break;
          case 'region':
            endRun();
            items.push({ kind: 'block', lines: [standIn()] });
            break;
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
            items.push({ kind: 'block', lines: linesOf(child, regions) });
            break;
        }
      }
    }
  }

  visit(block);
  endRun();
  return items;
}

function standIn(): Line {
  const line: Line = [];
  standIns.add(line);
  return line;
}

function endAtLastCheckedLine(lines: Line[]): Line[] {
  if (!standIns.has(lines.at(-1) ?? [])) return lines;
  let end = lines.length;
  while (end > 1 && (standIns.has(lines[end - 1]!) || textOf(lines[end - 1]!).trim() === '')) end--;
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
