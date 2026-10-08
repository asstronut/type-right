import type { CheckError } from './errors';
import { LlmFailedError, RateLimitedError, type Engine, type LlmFailure } from './engine';
import type { LlmProviderId } from './llm-providers';
import { isInDictionary, isLlmAllowed, isSiteDisabled, isSiteExcluded, type Settings } from './settings';

export interface CheckEngines {
  languageTool: Engine;
  /** Checks one complete sentence at a time; without it only LanguageTool runs. */
  llm?: Engine;
}

export interface CheckSite {
  hostname: string;
  /** The current Settings, read at check time so changes apply without a reload. */
  settings(): Settings;
}

/**
 * Whether the field's text goes to the LLM: `active` when it does, `lt-only`
 * when the user chose not to, `failing` when it should but can't right now.
 */
export type LlmHealth =
  | { state: 'active' }
  | { state: 'lt-only'; reason: 'no-consent' | 'excluded-site' }
  | { state: 'failing'; reason: LlmFailure };

export interface FieldCheckerOptions {
  engines: CheckEngines;
  /** The site the field is on; without it every check runs. */
  site?: CheckSite;
  /** Called with the field's current Errors whenever a check changes them. */
  onChange(errors: CheckError[]): void;
  /** Called with the LLM health whenever an LLM check changes it. */
  onLlmHealthChange?(health: LlmHealth): void;
  debounceMs?: number;
  llmDebounceMs?: number;
}

export interface FieldChecker {
  /**
   * Tells the checker the field's full text changed. Returns the Errors that are
   * still valid for the new text (shifted or dropped to match the edit) right
   * away, and schedules a debounced re-check of only the edited paragraph.
   */
  update(text: string): CheckError[];
  /**
   * The field's current Errors, without re-checking. Call it after Settings
   * change (e.g. the dictionary) to re-render with them applied.
   */
  errors(): CheckError[];
  /**
   * Hides the Error with this id in this field for as long as the field
   * lives, re-checks included. Notifies and returns the remaining Errors.
   */
  ignore(id: string): CheckError[];
  /** The LLM health for the current Settings. */
  llmHealth(): LlmHealth;
  dispose(): void;
}

const DEFAULT_DEBOUNCE_MS = 600;
const DEFAULT_LLM_DEBOUNCE_MS = 1500;
const MAX_CACHED_SENTENCES = 500;
const DEFAULT_RETRY_MS = 30_000;
const MIN_RETRY_MS = 1_000;
/** After any LLM failure, no LLM request is made for this long. */
const LLM_FAILURE_PAUSE_MS = 60_000;
/** LanguageTool's free tier rejects requests over 20k characters. */
const MAX_REQUEST_CHARS = 20_000;

interface Range {
  start: number;
  end: number;
}

export function createFieldChecker(options: FieldCheckerOptions): FieldChecker {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const llmDebounceMs = options.llmDebounceMs ?? DEFAULT_LLM_DEBOUNCE_MS;

  let text = '';
  let ltErrors: CheckError[] = [];
  let llmErrors: CheckError[] = [];
  /** Span of the text edited since it was last successfully checked. */
  let dirty: Range | null = null;
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let blockedUntil = 0;
  let disposed = false;
  let llmTimer: ReturnType<typeof setTimeout> | undefined;
  let llmRunning = false;
  let llmBlockedUntil = 0;
  /** LLM results by sentence text, so an unchanged sentence is never sent twice. */
  const llmCache = new Map<string, CheckError[]>();
  /** The LLM provider the cached results came from. */
  let llmCacheProvider: LlmProviderId | undefined;
  /** The last LLM check's failure, and the provider and key it happened with. */
  let llmFailure: { reason: LlmFailure; credentials: string } | undefined;
  /** Ids of the Errors the user chose to ignore in this field. */
  const ignored = new Set<string>();

  function update(next: string): CheckError[] {
    if (next === text) return errors();

    const edit = diff(text, next);
    const follow = (list: CheckError[]) =>
      list
        .filter((error) => !touchesEdit(error, edit, text, next))
        .map((error) => (error.start >= edit.oldEnd ? shift(error, edit.newEnd - edit.oldEnd) : error));
    ltErrors = follow(ltErrors);
    llmErrors = follow(llmErrors);
    dirty = unionRange(dirty && mapRange(dirty, edit), { start: edit.start, end: edit.newEnd });
    text = next;
    version++;
    schedule(debounceMs);
    if (options.engines.llm) scheduleLlm(llmDebounceMs);
    return errors();
  }

  /**
   * The field's Errors from both engines, in text order. Where both flag the
   * same words only the LLM's Error is kept, for its clearer explanation.
   * Spelling Errors on dictionary words are dropped before that merge, so they
   * never hide another Error; ignored Errors are dropped after it, so an
   * ignored LLM Error takes the LanguageTool Errors it replaced with it.
   */
  function errors(): CheckError[] {
    const settings = options.site?.settings();
    const withoutDictionaryWords = (list: CheckError[]) =>
      settings
        ? list.filter((e) => !(e.kind === 'spelling' && isInDictionary(text.slice(e.start, e.end), settings)))
        : list;
    const lt = withoutDictionaryWords(ltErrors);
    const llm = withoutDictionaryWords(llmErrors);
    const unmatched = lt.filter((l) => !llm.some((m) => l.start < m.end && m.start < l.end));
    return [...unmatched, ...llm].filter((error) => !ignored.has(error.id)).sort((a, b) => a.start - b.start);
  }

  function schedule(delayMs: number): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void fire(), delayMs);
  }

  async function fire(): Promise<void> {
    timer = undefined;
    if (disposed) return;
    if (options.site && isSiteDisabled(options.site.hostname, options.site.settings())) {
      dirty = null;
      return;
    }
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

      ltErrors = [
        ...ltErrors.filter((e) => e.end < paragraph.start || e.start > paragraph.end),
        ...found.map((e) => shift(e, paragraph.start)),
      ];
      dirty = dirty && dirty.end > paragraph.end ? { ...dirty, start: paragraph.end } : null;
      options.onChange(errors());
    }
    dirty = null;
  }

  function scheduleLlm(delayMs: number): void {
    if (llmTimer) clearTimeout(llmTimer);
    llmTimer = setTimeout(() => void fireLlm(), delayMs);
  }

  async function fireLlm(): Promise<void> {
    llmTimer = undefined;
    const llm = options.engines.llm;
    if (disposed || !llm) return;
    if (options.site && !isLlmAllowed(options.site.hostname, options.site.settings())) {
      // Consent withdrawn or the site excluded since the last check: drop what the LLM found.
      if (llmErrors.length) {
        llmErrors = [];
        options.onChange(errors());
      }
      return;
    }
    const provider = options.site?.settings().llmProvider;
    if (provider !== llmCacheProvider) {
      // Another provider's answers would not be this one's.
      llmCache.clear();
      llmCacheProvider = provider;
    }
    if (llmFailure && llmFailure.credentials !== credentials()) {
      // The user changed the key or provider, likely to fix the failure: try again now.
      setLlmFailure(undefined);
      llmBlockedUntil = 0;
    }
    const waitMs = llmBlockedUntil - Date.now();
    if (waitMs > 0) return scheduleLlm(waitMs);
    if (llmRunning) return scheduleLlm(llmDebounceMs);

    llmRunning = true;
    try {
      await checkSentences(llm);
    } finally {
      llmRunning = false;
    }
  }

  /** Puts each complete sentence's LLM Errors in place, asking the LLM only about uncached ones. */
  async function checkSentences(llm: Engine): Promise<void> {
    const startVersion = version;
    for (const sentence of completeSentences(text)) {
      const sentenceText = text.slice(sentence.start, sentence.end);
      let found = llmCache.get(sentenceText);
      if (!found) {
        try {
          found = await llm.check(sentenceText);
        } catch (error) {
          setLlmFailure(error instanceof LlmFailedError ? error.failure : 'bad-response');
          llmBlockedUntil = Date.now() + LLM_FAILURE_PAUSE_MS;
          scheduleLlm(0);
          return;
        }
        setLlmFailure(undefined);
        cacheLlmResult(sentenceText, found);
        // The text moved on; the newer edit has its own check queued, which will hit the cache.
        if (version !== startVersion || disposed) return;
      }

      llmErrors = [
        ...llmErrors.filter((e) => e.end <= sentence.start || e.start >= sentence.end),
        ...found.map((e) => shift(e, sentence.start)),
      ];
      options.onChange(errors());
    }
  }

  function ignore(id: string): CheckError[] {
    ignored.add(id);
    const remaining = errors();
    options.onChange(remaining);
    return remaining;
  }

  function llmHealth(): LlmHealth {
    const settings = options.site?.settings();
    if (settings && options.site) {
      if (!settings.llmConsent) return { state: 'lt-only', reason: 'no-consent' };
      if (isSiteExcluded(options.site.hostname, settings)) return { state: 'lt-only', reason: 'excluded-site' };
      if (!settings.llmApiKey) return { state: 'failing', reason: 'no-key' };
    }
    if (llmFailure && llmFailure.credentials === credentials()) return { state: 'failing', reason: llmFailure.reason };
    return { state: 'active' };
  }

  function setLlmFailure(reason: LlmFailure | undefined): void {
    if (reason === llmFailure?.reason) return;
    llmFailure = reason && { reason, credentials: credentials() };
    options.onLlmHealthChange?.(llmHealth());
  }

  /** Identifies the provider and key an LLM request is sent with. */
  function credentials(): string {
    const settings = options.site?.settings();
    return settings ? `${settings.llmProvider}:${settings.llmApiKey}` : '';
  }

  /** Keeps the cache bounded on long-lived fields by forgetting the oldest sentence first. */
  function cacheLlmResult(sentenceText: string, found: CheckError[]): void {
    llmCache.set(sentenceText, found);
    if (llmCache.size > MAX_CACHED_SENTENCES) llmCache.delete(llmCache.keys().next().value!);
  }

  function dispose(): void {
    disposed = true;
    if (timer) clearTimeout(timer);
    if (llmTimer) clearTimeout(llmTimer);
  }

  return { update, errors, ignore, llmHealth, dispose };
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

const SENTENCE_END = /[.?!]/;
const CLOSERS = /[.?!"'”’)\]]/;

/**
 * The sentences ready for the LLM: those ending in `.`, `?` or `!` (plus any
 * closing quotes or brackets) followed by whitespace or the end of the text.
 * A sentence never spans a line break, so an unfinished line is skipped.
 */
function completeSentences(text: string): Range[] {
  const sentences: Range[] = [];
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\n') {
      start = -1;
    } else if (start === -1) {
      if (!/\s/.test(char)) start = i;
    }
    if (start === -1 || !SENTENCE_END.test(char)) continue;
    let end = i + 1;
    while (end < text.length && CLOSERS.test(text[end]!)) end++;
    if (end < text.length && !/\s/.test(text[end]!)) continue;
    sentences.push({ start, end });
    start = -1;
    i = end - 1;
  }
  return sentences;
}
