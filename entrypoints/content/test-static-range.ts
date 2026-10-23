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

export function installStaticRange(): void {
  vi.stubGlobal('StaticRange', StubStaticRange);
}

export function textUnder(range: AbstractRange): string {
  const live = document.createRange();
  live.setStart(range.startContainer, range.startOffset);
  live.setEnd(range.endContainer, range.endOffset);
  return live.toString();
}
