import { SLIP_KINDS, type Slip, type SlipKind } from '../../lib/slips';

export const KIND_COLORS: Record<SlipKind, string> = {
  spelling: '#e11d48',
  grammar: '#2563eb',
  wording: '#7c3aed',
  translation: '#0f766e',
};

/** The line sits below the glyphs, so a pointer on it is up to this far under the highlighted range. */
const PROBE_OFFSETS_PX = [0, 3, 6];

export const UNDERLINE_REACH_PX = Math.max(...PROBE_OFFSETS_PX);

export interface DrawnSlip {
  slip: Slip;
  range: AbstractRange;
}

export interface SlipHit {
  slip: Slip;
  /** The box of the underlined line under the pointer, for placing the Hover card. */
  rect: DOMRect;
}

/**
 * The page's underlines: one CSS highlight per Kind, shared by every Field,
 * which each draws its own Slips into.
 */
export interface Underlines {
  /** Replaces `owner`'s underlines with `drawn`. */
  draw(owner: object, drawn: DrawnSlip[]): void;
  hitAt(owner: object, x: number, y: number): SlipHit | undefined;
  /** Where `owner`'s underline for `slip` is now, or `undefined` when it has none. */
  boundsOf(owner: object, slip: Slip): DOMRect | undefined;
  forget(owner: object): void;
  /** Leaves the registry: deletes each name only while it still holds our own Highlight. */
  dispose(): void;
}

type Measurable = Pick<Range, 'getBoundingClientRect' | 'getClientRects'>;

const highlightName = (kind: SlipKind) => `type-right-${kind}`;

export function createUnderlines(): Underlines {
  const drawn = new Map<object, Map<AbstractRange, Slip>>();
  let highlights: Record<SlipKind, Highlight> | undefined;
  let style: HTMLStyleElement | undefined;

  /**
   * Puts our highlights and their style on the page, again if the page took
   * them away or replaced a name (a re-injected content script shares the names).
   */
  function register(): Record<SlipKind, Highlight> {
    if (!highlights) {
      const created = {} as Record<SlipKind, Highlight>;
      for (const kind of SLIP_KINDS) created[kind] = new Highlight();
      highlights = created;
    }
    for (const kind of SLIP_KINDS) {
      if (CSS.highlights.get(highlightName(kind)) !== highlights[kind]) {
        CSS.highlights.set(highlightName(kind), highlights[kind]);
      }
    }
    style ??= createStyle();
    if (!style.isConnected) document.documentElement.appendChild(style);
    return highlights;
  }

  function release(owner: object): void {
    const ranges = drawn.get(owner);
    if (!ranges || !highlights) return;
    for (const [range, slip] of ranges) {
      highlights[slip.kind].delete(range);
      if (isOpaque(range)) range.disconnect();
    }
    drawn.delete(owner);
  }

  return {
    draw(owner, next) {
      const ours = register();
      release(owner);
      const ranges = new Map<AbstractRange, Slip>();
      for (const { slip, range } of next) {
        ours[slip.kind].add(range);
        ranges.set(range, slip);
      }
      drawn.set(owner, ranges);
    },

    hitAt(owner, x, y) {
      const ranges = drawn.get(owner);
      if (!ranges?.size) return undefined;
      const ours = Object.values(register());
      for (const offset of PROBE_OFFSETS_PX) {
        const probeY = y - offset;
        for (const { highlight, ranges: covering } of CSS.highlights.highlightsFromPoint(x, probeY)) {
          if (!ours.includes(highlight)) continue;
          for (const range of covering) {
            const slip = ranges.get(range);
            if (slip) return { slip, rect: rectAt(range, x, probeY) };
          }
        }
      }
      return undefined;
    },

    boundsOf(owner, slip) {
      for (const [range, { id, start, end }] of drawn.get(owner) ?? []) {
        if (id === slip.id && start === slip.start && end === slip.end) return measurable(range).getBoundingClientRect();
      }
      return undefined;
    },

    forget: release,

    dispose() {
      for (const owner of drawn.keys()) release(owner);
      if (highlights) {
        for (const kind of SLIP_KINDS) {
          if (CSS.highlights.get(highlightName(kind)) === highlights[kind]) CSS.highlights.delete(highlightName(kind));
        }
      }
      style?.remove();
    },
  };
}

function createStyle(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = SLIP_KINDS.map(
    (kind) => `::highlight(${highlightName(kind)}) { text-decoration: underline wavy ${KIND_COLORS[kind]}; }`,
  ).join('\n');
  return style;
}

function isOpaque(range: AbstractRange): range is OpaqueRange {
  return 'disconnect' in range;
}

function isMeasurable(range: AbstractRange): range is AbstractRange & Measurable {
  return 'getClientRects' in range;
}

function measurable(range: AbstractRange): Measurable {
  return isMeasurable(range) ? range : liveRangeOf(range);
}

function rectAt(range: AbstractRange, x: number, y: number): DOMRect {
  const measured = measurable(range);
  for (const rect of measured.getClientRects()) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return rect;
  }
  return measured.getBoundingClientRect();
}

function liveRangeOf(range: AbstractRange): Range {
  const live = document.createRange();
  live.setStart(range.startContainer, range.startOffset);
  live.setEnd(range.endContainer, range.endOffset);
  return live;
}
