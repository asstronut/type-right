import type { Slip, SlipSource } from './slips';

/** A span of a Field's text, from `start` up to (not including) `end`. */
export interface TextSpan {
  start: number;
  end: number;
}

/**
 * A Field's text and the Slips each Engine found in it, kept in step with
 * every edit. Pure state: it knows nothing of timers, Engines or Settings.
 */
export interface SlipTracker {
  text(): string;
  /** Changes with every edit: a check that started on another version has stale results. */
  version(): number;
  /**
   * Follows the Field's text to `next`: drops the Slips whose words the edit
   * changes, shifts the ones after it, and grows the dirty span over it.
   * Returns false, changing nothing, when the text is the same.
   */
  applyEdit(next: string): boolean;
  /**
   * Puts the Slips `source` found in `span` in place of the ones it had there.
   * `found` is relative to the span's start. With `dropTouching`, Slips that
   * only touch the span's edges are replaced too.
   */
  replaceSlips(source: SlipSource, span: TextSpan, found: Slip[], options?: { dropTouching?: boolean }): void;
  /** Drops all of `source`'s Slips. Returns whether it had any. */
  clearSlips(source: SlipSource): boolean;
  /**
   * The Field's Slips from both Engines, in text order. Where both flag the
   * same words only the LLM's Slip is kept, for its clearer explanation.
   * Spelling Slips on Dictionary words are dropped before that merge, so they
   * never hide another Slip; Ignore here Slips are dropped after it, so an
   * ignored LLM Slip takes the LanguageTool Slips it replaced with it.
   * Slips touching a never-flag span are dropped at the same point as Dictionary words.
   */
  slips(isDictionaryWord?: (word: string) => boolean): Slip[];
  /**
   * Replaces the spans of the text that never get a Slip. They are the Field's
   * current ones, so they are not followed through edits.
   */
  setNeverFlag(spans: readonly TextSpan[]): void;
  /** Hides the Slips with this id (Ignore here) for as long as the tracker lives, re-found ones included. */
  ignore(id: string): void;
  /** The span of the text edited since it was last checked, or null when it is all checked. */
  dirty(): TextSpan | null;
  /** Moves the dirty span's start to `position` (once the text before it is checked), keeping its end. */
  moveDirtyStart(position: number): void;
  clearDirty(): void;
}

export function createSlipTracker(): SlipTracker {
  let text = '';
  let version = 0;
  const found: Record<SlipSource, Slip[]> = { languagetool: [], llm: [] };
  let dirty: TextSpan | null = null;
  const ignored = new Set<string>();
  let neverFlag: readonly TextSpan[] = [];

  function applyEdit(next: string): boolean {
    if (next === text) return false;
    const edit = findEdit(text, next);
    for (const source of SOURCES) {
      found[source] = found[source]
        .filter((slip) => !touchesEdit(slip, edit, text, next))
        .map((slip) => (slip.start >= edit.oldEnd ? shift(slip, edit.newEnd - edit.oldEnd) : slip));
    }
    dirty = unionSpan(dirty && mapSpan(dirty, edit), { start: edit.start, end: edit.newEnd });
    text = next;
    version++;
    return true;
  }

  function replaceSlips(source: SlipSource, span: TextSpan, slips: Slip[], options?: { dropTouching?: boolean }): void {
    const outside = options?.dropTouching
      ? (slip: Slip) => slip.end < span.start || slip.start > span.end
      : (slip: Slip) => slip.end <= span.start || slip.start >= span.end;
    found[source] = [
      ...found[source].filter(outside),
      ...slips.map((slip) => shift(slip, span.start)),
    ];
  }

  function slips(isDictionaryWord?: (word: string) => boolean): Slip[] {
    const flaggable = (list: Slip[]) =>
      list.filter(
        (slip) =>
          !neverFlag.some((span) => slip.start < span.end && span.start < slip.end) &&
          !(slip.kind === 'spelling' && isDictionaryWord?.(text.slice(slip.start, slip.end))),
      );
    const lt = flaggable(found.languagetool);
    const llm = flaggable(found.llm);
    const unmatched = lt.filter((l) => !llm.some((m) => l.start < m.end && m.start < l.end));
    return [...unmatched, ...llm].filter((slip) => !ignored.has(slip.id)).sort((a, b) => a.start - b.start);
  }

  return {
    text: () => text,
    version: () => version,
    applyEdit,
    replaceSlips,
    clearSlips: (source) => {
      const had = found[source].length > 0;
      found[source] = [];
      return had;
    },
    slips,
    setNeverFlag: (spans) => {
      neverFlag = spans;
    },
    ignore: (id) => {
      ignored.add(id);
    },
    dirty: () => dirty,
    moveDirtyStart: (position) => {
      if (dirty) dirty = { ...dirty, start: position };
    },
    clearDirty: () => {
      dirty = null;
    },
  };
}

const SOURCES = ['languagetool', 'llm'] as const satisfies readonly SlipSource[];

interface Edit {
  start: number;
  oldEnd: number;
  newEnd: number;
}

/** The smallest single span of `prev` that, when replaced, produces `next`. */
function findEdit(prev: string, next: string): Edit {
  const limit = Math.min(prev.length, next.length);
  let start = 0;
  while (start < limit && prev[start] === next[start]) start++;
  let suffix = 0;
  while (
    suffix < limit - start &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  return { start, oldEnd: prev.length - suffix, newEnd: next.length - suffix };
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_'’]/u.test(char);
}

/**
 * Whether the edit changes the words a Slip covers. An edit that merely
 * touches its edge only counts when it joins onto the word (typing a letter
 * right after it), not when it follows it (typing a space).
 */
function touchesEdit(slip: Slip, edit: Edit, prev: string, next: string): boolean {
  if (slip.end < edit.start || slip.start > edit.oldEnd) return false;
  if (slip.end > edit.start && slip.start < edit.oldEnd) return true;
  if (slip.end === edit.start) return isWordChar(prev[edit.start]) || isWordChar(next[edit.start]);
  return isWordChar(prev[edit.oldEnd - 1]) || isWordChar(next[edit.newEnd - 1]);
}

function shift(slip: Slip, by: number): Slip {
  return by === 0 ? slip : { ...slip, start: slip.start + by, end: slip.end + by };
}

function mapSpan(span: TextSpan, edit: Edit): TextSpan {
  const map = (pos: number) =>
    pos <= edit.start ? pos : pos >= edit.oldEnd ? pos + edit.newEnd - edit.oldEnd : edit.newEnd;
  return { start: map(span.start), end: map(span.end) };
}

function unionSpan(a: TextSpan | null, b: TextSpan): TextSpan {
  return a ? { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) } : b;
}
