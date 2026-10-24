// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installHighlights } from './test-highlights';
import { createUnderlines, KIND_COLORS, type Underlines } from './underlines';
import { makeSlipId, type Slip, type SlipKind } from '../../lib/slips';

const LINE = new DOMRect(10, 80, 40, 16);
const BELOW_LINE = new DOMRect(10, 100, 60, 16);

function slip(kind: SlipKind = 'spelling'): Slip {
  return {
    id: makeSlipId(kind, 'word'),
    start: 0,
    end: 4,
    kind,
    type: 'Type',
    explanation: 'Explanation',
    suggestions: [],
    source: 'languagetool',
  };
}

function rangeOver(...rects: DOMRect[]) {
  const disconnect = vi.fn();
  const range = {
    startOffset: 0,
    endOffset: 4,
    disconnect,
    getClientRects: () => rects,
    getBoundingClientRect: () => rects[0],
  } as unknown as OpaqueRange;
  return { range, disconnect };
}

function paintedIn(kind: SlipKind): AbstractRange[] {
  return [...(CSS.highlights.get(`type-right-${kind}`) ?? [])];
}

let restoreHighlights: () => void;
let underlines: Underlines;

beforeEach(() => {
  restoreHighlights = installHighlights((range, x, y) =>
    [...(range as OpaqueRange).getClientRects()].some(
      (rect) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom,
    ),
  );
  underlines = createUnderlines();
});

afterEach(() => {
  underlines.dispose();
  restoreHighlights();
});

describe('drawing', () => {
  it('paints each Slip in the highlight of its Kind, with the Kind coloured and wavy', () => {
    const spelling = rangeOver(LINE);
    const grammar = rangeOver(LINE);

    underlines.draw({}, [
      { slip: slip('spelling'), range: spelling.range },
      { slip: slip('grammar'), range: grammar.range },
    ]);

    expect(paintedIn('spelling')).toEqual([spelling.range]);
    expect(paintedIn('grammar')).toEqual([grammar.range]);
    expect(paintedIn('wording')).toEqual([]);
    const style = document.documentElement.querySelector('style')?.textContent;
    expect(style).toMatch(new RegExp(`::highlight\\(type-right-grammar\\)\\s*\\{[^}]*underline wavy ${KIND_COLORS.grammar}`));
  });

  it('touches the page only once it has something to draw', () => {
    expect(CSS.highlights.size).toBe(0);
    expect(document.documentElement.querySelector('style')).toBeNull();
  });

  it('replaces an owner underlines and lets go of the old ranges', () => {
    const owner = {};
    const first = rangeOver(LINE);
    const second = rangeOver(LINE);
    underlines.draw(owner, [{ slip: slip(), range: first.range }]);

    underlines.draw(owner, [{ slip: slip(), range: second.range }]);

    expect(paintedIn('spelling')).toEqual([second.range]);
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(second.disconnect).not.toHaveBeenCalled();
  });

  it("forgets an owner's underlines and no one else's", () => {
    const leaving = {};
    const staying = {};
    const gone = rangeOver(LINE);
    const kept = rangeOver(LINE);
    underlines.draw(leaving, [{ slip: slip(), range: gone.range }]);
    underlines.draw(staying, [{ slip: slip(), range: kept.range }]);

    underlines.forget(leaving);

    expect(paintedIn('spelling')).toEqual([kept.range]);
    expect(gone.disconnect).toHaveBeenCalledOnce();
    expect(kept.disconnect).not.toHaveBeenCalled();
    expect(underlines.hitAt(leaving, 20, 85)).toBeUndefined();
    expect(underlines.hitAt(staying, 20, 85)).toBeDefined();
  });
});

describe("measuring a Slip's underline", () => {
  it("gives the box of the owner's underline for that Slip, and nothing for a Slip it doesn't underline", () => {
    const owner = {};
    underlines.draw(owner, [{ slip: slip(), range: rangeOver(BELOW_LINE).range }]);

    expect(underlines.boundsOf(owner, slip())).toEqual(BELOW_LINE);
    expect(underlines.boundsOf(owner, { ...slip(), start: 5, end: 9 })).toBeUndefined();
    expect(underlines.boundsOf({}, slip())).toBeUndefined();
  });
});

describe('finding the Slip under the pointer', () => {
  it('probes the line below the glyphs, up to 6 px under them', () => {
    const owner = {};
    const flagged = slip();
    underlines.draw(owner, [{ slip: flagged, range: rangeOver(LINE).range }]);

    expect(underlines.hitAt(owner, 20, 85)?.slip).toBe(flagged);
    expect(underlines.hitAt(owner, 20, 98)?.slip).toBe(flagged);
    expect(underlines.hitAt(owner, 20, 101)?.slip).toBe(flagged);
    expect(underlines.hitAt(owner, 20, 102)).toBeUndefined();
    expect(underlines.hitAt(owner, 60, 85)).toBeUndefined();
  });

  it('answers with the line box that holds the pointer, for a Slip that wraps', () => {
    const owner = {};
    underlines.draw(owner, [{ slip: slip(), range: rangeOver(LINE, BELOW_LINE).range }]);

    expect(underlines.hitAt(owner, 20, 85)?.rect).toBe(LINE);
    expect(underlines.hitAt(owner, 20, 118)?.rect).toBe(BELOW_LINE);
  });

  it("only finds an owner's own Slips, even where another owner's are painted too", () => {
    const [first, second] = [{}, {}];
    const [firstSlip, secondSlip] = [slip('spelling'), slip('grammar')];
    underlines.draw(first, [{ slip: firstSlip, range: rangeOver(LINE).range }]);
    underlines.draw(second, [{ slip: secondSlip, range: rangeOver(LINE).range }]);

    expect(underlines.hitAt(first, 20, 85)?.slip).toBe(firstSlip);
    expect(underlines.hitAt(second, 20, 85)?.slip).toBe(secondSlip);
    expect(underlines.hitAt({}, 20, 85)).toBeUndefined();
  });

  it('measures a range that has no rects of its own through a live Range', () => {
    const owner = {};
    const flagged = slip();
    const text = document.body.appendChild(document.createTextNode('flagged'));
    const staticRange = { startContainer: text, startOffset: 0, endContainer: text, endOffset: 4 };
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([LINE] as unknown as DOMRectList);
    underlines.draw(owner, [{ slip: flagged, range: staticRange as unknown as AbstractRange }]);
    vi.spyOn(CSS.highlights, 'highlightsFromPoint').mockImplementation(() => [
      { highlight: CSS.highlights.get('type-right-spelling')!, ranges: [staticRange as unknown as AbstractRange] },
    ]);

    expect(underlines.hitAt(owner, 20, 85)).toEqual({ slip: flagged, rect: LINE });
  });
});

describe('sharing the page with others', () => {
  it('puts a highlight back when the page replaced or deleted it', () => {
    const owner = {};
    const flagged = slip();
    underlines.draw(owner, [{ slip: flagged, range: rangeOver(LINE).range }]);
    const replacement = new Highlight();

    CSS.highlights.set('type-right-spelling', replacement);
    expect(underlines.hitAt(owner, 20, 85)?.slip).toBe(flagged);
    expect(CSS.highlights.get('type-right-spelling')).not.toBe(replacement);

    CSS.highlights.delete('type-right-spelling');
    underlines.draw(owner, [{ slip: flagged, range: rangeOver(LINE).range }]);
    expect(paintedIn('spelling')).toHaveLength(1);
  });

  it('puts its style back when the page removed it', () => {
    const owner = {};
    underlines.draw(owner, []);
    document.documentElement.querySelector('style')?.remove();

    underlines.draw(owner, []);

    expect(document.documentElement.querySelectorAll('style')).toHaveLength(1);
  });

  it("leaves highlights that aren't its own alone, never clearing the registry", () => {
    const other = new Highlight();
    CSS.highlights.set('search-match', other);
    const clear = vi.spyOn(CSS.highlights, 'clear');
    const owner = {};

    underlines.draw(owner, [{ slip: slip(), range: rangeOver(LINE).range }]);
    underlines.forget(owner);
    underlines.dispose();

    expect(CSS.highlights.get('search-match')).toBe(other);
    expect(clear).not.toHaveBeenCalled();
  });

  it('leaves the registry on dispose, keeping a name the page took over', () => {
    const owner = {};
    const range = rangeOver(LINE);
    underlines.draw(owner, [
      { slip: slip('spelling'), range: range.range },
      { slip: slip('grammar'), range: rangeOver(LINE).range },
    ]);
    const foreign = new Highlight();
    CSS.highlights.set('type-right-spelling', foreign);

    underlines.dispose();

    expect(CSS.highlights.get('type-right-spelling')).toBe(foreign);
    expect(CSS.highlights.has('type-right-grammar')).toBe(false);
    expect(range.disconnect).toHaveBeenCalledOnce();
    expect(document.documentElement.querySelector('style')).toBeNull();
  });
});
