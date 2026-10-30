import { vi } from 'vitest';

type Covers = (range: AbstractRange, x: number, y: number) => boolean;

class StubHighlight extends Set<AbstractRange> {
  priority = 0;
  type = 'highlight';
}

class StubRegistry extends Map<string, Highlight> {
  constructor(private readonly covers: Covers) {
    super();
  }

  highlightsFromPoint(x: number, y: number): HighlightHitResult[] {
    const hits: HighlightHitResult[] = [];
    for (const highlight of this.values()) {
      const ranges = [...highlight].filter((range) => this.covers(range, x, y));
      if (ranges.length) hits.push({ highlight, ranges });
    }
    return hits;
  }
}

/**
 * Gives a test environment without CSS highlights (happy-dom) a `Highlight`
 * and a `CSS.highlights` that hit-tests with `covers`, which by default paints
 * every range everywhere. Returns the function that takes them away again.
 */
export function installHighlights(covers: Covers = () => true): () => void {
  vi.stubGlobal('Highlight', StubHighlight);
  vi.stubGlobal('CSS', { ...CSS, highlights: new StubRegistry(covers) });
  return () => vi.unstubAllGlobals();
}
