import type { FieldRead } from './field';
import type { TextSpan } from '../../../lib/slip-tracker';

/** A run of one text node's characters that appears unchanged in the Field's text. */
interface Segment {
  node: Text;
  /** Where the run starts in the node's data. */
  nodeStart: number;
  /** The run's span in the Field's text. */
  start: number;
  end: number;
  /** The node's whole data when it was read, to tell whether the node has changed since. */
  data: string;
}

export interface RichTextReader {
  read(): Omit<FieldRead, 'composing'>;
}

/**
 * Reads a Rich editor's text the way the same lines would read in a textarea:
 * blocks and `<br>`s become line breaks, and what isn't typed prose (zero-width
 * characters, hidden nodes, placeholders) is left out.
 */
export function createRichTextReader(host: HTMLElement): RichTextReader {
  return {
    read() {
      const { text, segments } = layOut(linesOf(host));
      return { text, neverFlag: [], rangeFor: (span) => rangeOver(host, segments, span) };
    },
  };
}

/** One text node's characters that are in the text, and so go on one line. */
interface Piece {
  node: Text;
  nodeStart: number;
  text: string;
}

type Line = Piece[];

type Item = { kind: 'block'; lines: Line[] } | { kind: 'run'; lines: Line[]; isGap: boolean };

interface Run {
  lines: Line[];
  current: Line;
  hasBreak: boolean;
  endsWithBreak: boolean;
}

type Role = 'skip' | 'block' | 'inline' | 'br';

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'ul',
]);

const SKIPPED_TAGS = new Set(['script', 'style', 'template', 'noscript', 'img']);

/** No computed style: it forces layout, and a read runs on every edit. */
function classify(element: Element): Role {
  if (
    SKIPPED_TAGS.has(element.localName) ||
    element.hasAttribute('hidden') ||
    element.getAttribute('aria-hidden') === 'true' ||
    element.hasAttribute('data-slate-placeholder') ||
    (element instanceof HTMLElement && element.style.display === 'none')
  ) {
    return 'skip';
  }
  if (element.localName === 'br') return 'br';
  return BLOCK_TAGS.has(element.localName) ? 'block' : 'inline';
}

const TYPED_CHARACTERS = /[^\u200b\ufeff\u2060]+/g;

/** The characters of `node` that are in the text; each run between removed zero-width characters is a piece. */
function piecesOf(node: Text): Piece[] {
  return [...node.data.matchAll(TYPED_CHARACTERS)].map((match) => ({
    node,
    nodeStart: match.index,
    text: match[0].replace(/\u00a0/g, ' '),
  }));
}

const textOf = (line: Line): string => line.map((piece) => piece.text).join('');

/** The lines of a block: its inline runs and child blocks in order, an empty line if it has none. */
function linesOf(block: Element): Line[] {
  const items = itemsOf(block);
  const hasChildBlocks = items.some((item) => item.kind === 'block');
  // Whitespace that only formats the markup between blocks is not a line.
  const lines = items.flatMap((item) => (item.kind === 'run' && item.isGap && hasChildBlocks ? [] : item.lines));
  return lines.length ? lines : [[]];
}

function itemsOf(block: Element): Item[] {
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
        switch (classify(child)) {
          case 'skip':
            break;
          case 'br':
            run ??= startRun();
            breakLine(run);
            break;
          case 'inline':
            visit(child);
            break;
          case 'block':
            endRun();
            items.push({ kind: 'block', lines: linesOf(child) });
            break;
        }
      }
    }
  }

  visit(block);
  endRun();
  return items;
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
  // A `<br>` that ends a run only closes its line: trailing and placeholder breaks add nothing.
  if (run.endsWithBreak && run.lines.length > 1) run.lines.pop();
  return { kind: 'run', lines: run.lines, isGap: !run.hasBreak && /^\s*$/.test(textOf(run.current)) };
}

/** Joins the lines into the text, and records where each piece landed. */
function layOut(lines: Line[]): { text: string; segments: Segment[] } {
  const segments: Segment[] = [];
  let text = '';
  lines.forEach((line, index) => {
    if (index) text += '\n';
    for (const { node, nodeStart, text: run } of line) {
      segments.push({ node, nodeStart, start: text.length, end: text.length + run.length, data: node.data });
      text += run;
    }
  });
  return { text, segments };
}

interface Point {
  node: Node;
  offset: number;
  /** The segment the point is in, if it is in one. */
  segment?: Segment;
}

/**
 * The point in the DOM for a text offset. An offset on a segment's edge goes
 * where the span needs it: a start begins in the segment that starts there, an
 * end stays in the segment that ends there. An offset between segments, where
 * a line break is, goes to the end of the segment before it.
 */
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

/** Whether the point's text node is still in the editor with the data it was read with, so its offset still means the same characters. */
function isUnchanged(host: HTMLElement, { segment }: Point): boolean {
  return !segment || (host.contains(segment.node) && segment.node.data === segment.data);
}
