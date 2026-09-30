import type { CheckError } from './errors';
import { RateLimitedError, type Engine } from './engine';

export interface CheckEngines {
  languageTool: Engine;
}

export interface FieldCheckerOptions {
  engines: CheckEngines;
  /** Called with the field's current Errors whenever a check changes them. */
  onChange(errors: CheckError[]): void;
  debounceMs?: number;
}

export interface FieldChecker {
  /**
   * Tells the checker the field's full text changed. Returns the Errors that are
   * still valid for the new text (shifted or dropped to match the edit) right
   * away, and schedules a debounced re-check of only the edited paragraph.
   */
  update(text: string): CheckError[];
  dispose(): void;
}

const DEFAULT_DEBOUNCE_MS = 600;
const DEFAULT_RETRY_MS = 30_000;
const MIN_RETRY_MS = 1_000;
/** LanguageTool's free tier rejects requests over 20k characters. */
const MAX_REQUEST_CHARS = 20_000;

interface Range {
  start: number;
  end: number;
}

export function createFieldChecker(options: FieldCheckerOptions): FieldChecker {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let text = '';
  let errors: CheckError[] = [];
  /** Span of the text edited since it was last successfully checked. */
  let dirty: Range | null = null;
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let blockedUntil = 0;
  let disposed = false;

  function update(next: string): CheckError[] {
    if (next === text) return errors;

    const edit = diff(text, next);
    errors = errors
      .filter((error) => !touchesEdit(error, edit, text, next))
      .map((error) => (error.start >= edit.oldEnd ? shift(error, edit.newEnd - edit.oldEnd) : error));
    dirty = unionRange(dirty && mapRange(dirty, edit), { start: edit.start, end: edit.newEnd });
    text = next;
    version++;
    schedule(debounceMs);
    return errors;
  }

  function schedule(delayMs: number): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void fire(), delayMs);
  }

  async function fire(): Promise<void> {
    timer = undefined;
    if (disposed) return;
    const waitMs = blockedUntil - Date.now();
    if (waitMs > 0) return schedule(waitMs);
    if (running) return schedule(debounceMs);

    running = true;
    try {
      await checkDirtyParagraphs();
    } finally {
      running = false;
    }
  }

  async function checkDirtyParagraphs(): Promise<void> {
    const startVersion = version;
    if (!dirty) return;

    const targets = splitParagraphs(text).filter(
      (paragraph) => paragraph.start <= dirty!.end && paragraph.end >= dirty!.start,
    );

    for (const paragraph of targets) {
      let found: CheckError[] = [];
      const paragraphText = text.slice(paragraph.start, paragraph.end);
      if (paragraphText.trim()) {
        try {
          found = await options.engines.languageTool.check(paragraphText);
        } catch (error) {
          if (error instanceof RateLimitedError) {
            blockedUntil = Date.now() + Math.max(error.retryAfterMs ?? DEFAULT_RETRY_MS, MIN_RETRY_MS);
            if (version === startVersion && dirty) dirty = { ...dirty, start: paragraph.start };
            schedule(0);
          }
          // Any other failure is left for the next edit to retry.
          return;
        }
        // The text moved on while we waited; the newer edit has its own check queued.
        if (version !== startVersion || disposed) return;
      }

      errors = [
        ...errors.filter((e) => e.end < paragraph.start || e.start > paragraph.end),
        ...found.map((e) => shift(e, paragraph.start)),
      ].sort((a, b) => a.start - b.start);
      dirty = dirty && dirty.end > paragraph.end ? { ...dirty, start: paragraph.end } : null;
      options.onChange(errors);
    }
    dirty = null;
  }

  function dispose(): void {
    disposed = true;
    if (timer) clearTimeout(timer);
  }

  return { update, dispose };
}

interface Edit {
  start: number;
  oldEnd: number;
  newEnd: number;
}

/** The smallest single span of `prev` that, when replaced, produces `next`. */
function diff(prev: string, next: string): Edit {
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
 * Whether the edit changes the words an Error covers. An edit that merely
 * touches its edge only counts when it joins onto the word (typing a letter
 * right after it), not when it follows it (typing a space).
 */
function touchesEdit(error: CheckError, edit: Edit, prev: string, next: string): boolean {
  if (error.end < edit.start || error.start > edit.oldEnd) return false;
  if (error.end > edit.start && error.start < edit.oldEnd) return true;
  if (error.end === edit.start) return isWordChar(prev[edit.start]) || isWordChar(next[edit.start]);
  return isWordChar(prev[edit.oldEnd - 1]) || isWordChar(next[edit.newEnd - 1]);
}

function shift(error: CheckError, by: number): CheckError {
  return by === 0 ? error : { ...error, start: error.start + by, end: error.end + by };
}

function mapRange(range: Range, edit: Edit): Range {
  const map = (pos: number) =>
    pos <= edit.start ? pos : pos >= edit.oldEnd ? pos + edit.newEnd - edit.oldEnd : edit.newEnd;
  return { start: map(range.start), end: map(range.end) };
}

function unionRange(a: Range | null, b: Range): Range {
  return a ? { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) } : b;
}

/** Paragraphs are separated by blank lines; oversized ones are cut to fit one request. */
function splitParagraphs(text: string): Range[] {
  const paragraphs: Range[] = [];
  let start = 0;
  const push = (end: number) => {
    for (let from = start; ; ) {
      let to = Math.min(end, from + MAX_REQUEST_CHARS);
      if (to < end) {
        const cut = text.lastIndexOf(' ', to);
        if (cut > from) to = cut + 1;
      }
      paragraphs.push({ start: from, end: to });
      if (to >= end) break;
      from = to;
    }
  };
  for (const separator of text.matchAll(/\n\s*\n/g)) {
    push(separator.index);
    start = separator.index + separator[0].length;
  }
  push(text.length);
  return paragraphs;
}
