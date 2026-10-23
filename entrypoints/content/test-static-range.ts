import { vi } from 'vitest';

class StubStaticRange implements StaticRange {
  readonly startContainer: Node;
  readonly startOffset: number;
  readonly endContainer: Node;
  readonly endOffset: number;

  constructor(init: StaticRangeInit) {
    this.startContainer = init.startContainer;
    this.startOffset = init.startOffset;
    this.endContainer = init.endContainer;
    this.endOffset = init.endOffset;
  }

  get collapsed(): boolean {
    return this.startContainer === this.endContainer && this.startOffset === this.endOffset;
  }
}

/** Gives a test environment without `StaticRange` (happy-dom) one that keeps its endpoints. `vi.unstubAllGlobals()` takes it away again. */
export function installStaticRange(): void {
  vi.stubGlobal('StaticRange', StubStaticRange);
}

/** The text a range covers in the page, as the browser would highlight it. */
export function textUnder(range: AbstractRange): string {
  const live = document.createRange();
  live.setStart(range.startContainer, range.startOffset);
  live.setEnd(range.endContainer, range.endOffset);
  return live.toString();
}
