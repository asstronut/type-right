/** Browser APIs `lib.dom` does not have yet. */

/** A live range over a textarea's value, which the DOM has no nodes for. Drop it with `disconnect()`. */
interface OpaqueRange extends AbstractRange {
  disconnect(): void;
  getBoundingClientRect(): DOMRect;
  getClientRects(): DOMRectList;
}

interface HTMLTextAreaElement {
  createValueRange(start: number, end: number): OpaqueRange;
}

interface HighlightHitResult {
  highlight: Highlight;
  ranges: AbstractRange[];
}

interface HighlightRegistry {
  highlightsFromPoint(x: number, y: number): HighlightHitResult[];
}
