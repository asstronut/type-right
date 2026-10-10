import { makeSightingKey, type Slip } from './slips';
import type { SlipSighting } from './slip-tally';
import { LlmFailedError, RateLimitedError, type Engine, type LlmFailure } from './engine';
import { createSharedLlmFailure, LLM_FAILURE_PAUSE_MS, type SharedLlmFailure } from './llm-failure';
import type { LlmProviderId } from './llm-providers';
import {
  isInDictionary,
  isLlmAllowed,
  isSiteDisabled,
  isSiteExcluded,
  llmCredentials,
  type Settings,
} from './settings';

export interface CheckEngines {
  languageTool: Engine;
  /** Checks one finished sentence at a time; without it only LanguageTool runs. */
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
  /** Called with the field's current Slips whenever a check changes them. */
  onChange(slips: Slip[]): void;
  /**
   * The LLM's last failure, shared with the other Fields in the tab; without
   * it the field keeps its own.
   */
  llmFailure?: SharedLlmFailure;
  /** Called with the LLM health whenever an LLM check, here or in another Field, changes it. */
  onLlmHealthChange?(health: LlmHealth): void;
  /**
   * Called with Slips this field hasn't reported before, once their sentence
   * is finished (ends in `.`, `?`, `!` or a line break) and, while the LLM is
   * active, the LLM has checked it too, so a Slip is reported as it was
   * finally classified.
   */
  onSlipsSeen?(sightings: SlipSighting[]): void;
  debounceMs?: number;
  llmDebounceMs?: number;
}

export interface FieldChecker {
  /**
   * Tells the checker the field's full text changed. Returns the Slips that are
   * still valid for the new text (shifted or dropped to match the edit) right
   * away, and schedules a debounced re-check of only the edited paragraph.
   */
  update(text: string): Slip[];
  /**
   * The field's current Slips, without re-checking. Call it after Settings
   * change (e.g. the dictionary) to re-render with them applied.
   */
  slips(): Slip[];
  /**
   * Hides the Slip with this id in this field for as long as the field
   * lives, re-checks included. Notifies and returns the remaining Slips.
   */
  ignore(id: string): Slip[];
  /** The LLM health for the current Settings. */
  llmHealth(): LlmHealth;
  /**
   * Forgets which Slips were passed to `onSlipsSeen`, after the counts are
   * reset, so the field's next check reports them again.
   */
  forgetReported(): void;
  dispose(): void;
}

const DEFAULT_DEBOUNCE_MS = 600;
const DEFAULT_LLM_DEBOUNCE_MS = 1500;
const MAX_CACHED_SENTENCES = 500;
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
  const llmDebounceMs = options.llmDebounceMs ?? DEFAULT_LLM_DEBOUNCE_MS;

  let text = '';
  let ltSlips: Slip[] = [];
  let llmSlips: Slip[] = [];
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
  const llmCache = new Map<string, Slip[]>();
  /** The LLM provider the cached results came from. */
  let llmCacheProvider: LlmProviderId | undefined;
  /** The LLM's last failure, and the provider and key it happened with; maybe shared with other Fields. */
  const llmFailure = options.llmFailure ?? createSharedLlmFailure();
  const stopWatchingLlmFailure = llmFailure.watch(() => {
    if (disposed) return;
    const health = llmHealth();
    options.onLlmHealthChange?.(health);
    // Slips held back for the LLM count now that it can't check their sentence.
    if (health.state === 'failing') reportSightings(slips());
    // The LLM works again, maybe after another field's check: no need to sit out this field's pause.
    if (!llmFailure.get() && llmBlockedUntil > Date.now()) {
      llmBlockedUntil = 0;
      scheduleLlm(0);
    }
  });
  /** Ids of the Slips the user chose to ignore in this field. */
  const ignored = new Set<string>();
  /** Keys of the Slips already passed to `onSlipsSeen`. */
  const reported = new Set<string>();

  function update(next: string): Slip[] {
    if (next === text) return slips();

    const edit = diff(text, next);
    const follow = (list: Slip[]) =>
      list
        .filter((slip) => !touchesEdit(slip, edit, text, next))
        .map((slip) => (slip.start >= edit.oldEnd ? shift(slip, edit.newEnd - edit.oldEnd) : slip));
    ltSlips = follow(ltSlips);
    llmSlips = follow(llmSlips);
    dirty = unionRange(dirty && mapRange(dirty, edit), { start: edit.start, end: edit.newEnd });
    text = next;
    version++;
    schedule(debounceMs);
    if (options.engines.llm) scheduleLlm(llmDebounceMs);
    return slips();
  }

  /**
   * The field's Slips from both engines, in text order. Where both flag the
   * same words only the LLM's Slip is kept, for its clearer explanation.
   * Spelling Slips on dictionary words are dropped before that merge, so they
   * never hide another Slip; ignored Slips are dropped after it, so an
   * ignored LLM Slip takes the LanguageTool Slips it replaced with it.
   */
  function slips(): Slip[] {
    const settings = options.site?.settings();
    const withoutDictionaryWords = (list: Slip[]) =>
      settings
        ? list.filter((e) => !(e.kind === 'spelling' && isInDictionary(text.slice(e.start, e.end), settings)))
        : list;
    const lt = withoutDictionaryWords(ltSlips);
    const llm = withoutDictionaryWords(llmSlips);
    const unmatched = lt.filter((l) => !llm.some((m) => l.start < m.end && m.start < l.end));
    return [...unmatched, ...llm].filter((slip) => !ignored.has(slip.id)).sort((a, b) => a.start - b.start);
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
      let found: Slip[] = [];
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

      ltSlips = [
        ...ltSlips.filter((e) => e.end < paragraph.start || e.start > paragraph.end),
        ...found.map((e) => shift(e, paragraph.start)),
      ];
      dirty = dirty && dirty.end > paragraph.end ? { ...dirty, start: paragraph.end } : null;
      notify();
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
      if (llmSlips.length) {
        llmSlips = [];
        notify();
      }
      return;
    }
    const provider = options.site?.settings().llmProvider;
    if (provider !== llmCacheProvider) {
      // Another provider's answers would not be this one's.
      llmCache.clear();
      llmCacheProvider = provider;
    }
    const failure = llmFailure.get();
    if (failure && failure.credentials !== credentials()) {
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

  /** Puts each finished sentence's LLM Slips in place, asking the LLM only about uncached ones. */
  async function checkSentences(llm: Engine): Promise<void> {
    const startVersion = version;
    for (const sentence of finishedSentences(text)) {
      const sentenceText = text.slice(sentence.start, sentence.end);
      let found = llmCache.get(sentenceText);
      if (!found) {
        try {
          found = await llm.check(sentenceText);
        } catch (error) {
          const failed = error instanceof LlmFailedError ? error : new LlmFailedError('bad-response');
          setLlmFailure(failed.failure);
          llmBlockedUntil = Date.now() + (failed.retryAfterMs ?? LLM_FAILURE_PAUSE_MS);
          scheduleLlm(0);
          return;
        }
        setLlmFailure(undefined);
        cacheLlmResult(sentenceText, found);
        // The text moved on; the newer edit has its own check queued, which will hit the cache.
        if (version !== startVersion || disposed) return;
      }

      llmSlips = [
        ...llmSlips.filter((e) => e.end <= sentence.start || e.start >= sentence.end),
        ...found.map((e) => shift(e, sentence.start)),
      ];
      notify();
    }
  }

  function ignore(id: string): Slip[] {
    ignored.add(id);
    return notify();
  }

  /** Passes the field's current Slips to `onChange`, and reports any newly settled ones. */
  function notify(): Slip[] {
    const current = slips();
    options.onChange(current);
    reportSightings(current);
    return current;
  }

  function reportSightings(current: Slip[]): void {
    if (!options.onSlipsSeen) return;
    const waitForLlm = options.engines.llm !== undefined && llmHealth().state === 'active';
    const sightings: SlipSighting[] = [];
    for (const sentence of finishedSentences(text)) {
      const sentenceText = text.slice(sentence.start, sentence.end);
      if (waitForLlm && !llmCache.has(sentenceText)) continue;
      for (const slip of current) {
        if (slip.start < sentence.start || slip.end > sentence.end) continue;
        const key = makeSightingKey(slip.kind, sentenceText, text.slice(slip.start, slip.end));
        if (reported.has(key)) continue;
        reported.add(key);
        sightings.push({ key, kind: slip.kind, type: slip.type });
      }
    }
    if (sightings.length) options.onSlipsSeen(sightings);
  }

  function llmHealth(): LlmHealth {
    const settings = options.site?.settings();
    if (settings && options.site) {
      if (!settings.llmConsent) return { state: 'lt-only', reason: 'no-consent' };
      if (isSiteExcluded(options.site.hostname, settings)) return { state: 'lt-only', reason: 'excluded-site' };
      if (!settings.llmApiKey) return { state: 'failing', reason: 'no-key' };
    }
    const failure = llmFailure.get();
    if (failure && failure.credentials === credentials()) return { state: 'failing', reason: failure.reason };
    return { state: 'active' };
  }

  function setLlmFailure(reason: LlmFailure | undefined): void {
    llmFailure.set(reason && { reason, credentials: credentials() });
  }

  /** Identifies the provider and key an LLM request is sent with. */
  function credentials(): string {
    const settings = options.site?.settings();
    return settings ? llmCredentials(settings) : '';
  }

  /** Keeps the cache bounded on long-lived fields by forgetting the oldest sentence first. */
  function cacheLlmResult(sentenceText: string, found: Slip[]): void {
    llmCache.set(sentenceText, found);
    if (llmCache.size > MAX_CACHED_SENTENCES) llmCache.delete(llmCache.keys().next().value!);
  }

  function dispose(): void {
    disposed = true;
    stopWatchingLlmFailure();
    if (timer) clearTimeout(timer);
    if (llmTimer) clearTimeout(llmTimer);
  }

  return { update, slips, ignore, llmHealth, forgetReported: () => reported.clear(), dispose };
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
 * The finished sentences, ready for the LLM and the Tally: those
 * ending in `.`, `?` or `!` (plus any closing quotes or brackets) followed by
 * whitespace or the end of the text, and the unpunctuated end of any line a
 * line break has finished, without trailing whitespace. A sentence never spans
 * a line break, so only the unfinished last line is skipped.
 */
function finishedSentences(text: string): Range[] {
  const sentences: Range[] = [];
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\n') {
      if (start !== -1) {
        let end = i;
        while (/\s/.test(text[end - 1]!)) end--;
        sentences.push({ start, end });
      }
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
