import { makeSightingKey, type Slip } from './slips';
import type { SlipSighting } from './slip-tally';
import { LLM_FAILURE_PAUSE_MS, LlmFailedError, RateLimitedError, type Engine } from './engine';
import type { PageLlmHealth } from './llm-health';
import { isInDictionary, isSiteDisabled, type Settings } from './settings';
import { createSlipTracker, type TextSpan } from './slip-tracker';
import { createCheckScheduler } from './check-scheduler';

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

export interface FieldCheckerOptions {
  engines: CheckEngines;
  /**
   * The site the Field is on, for the Disabled site rule, the Dictionary and
   * the Provider the sentence cache is keyed by; without it every check runs.
   * Whether text may go to the LLM is `llmHealth`'s call.
   */
  site?: CheckSite;
  /** Called with the field's current Slips whenever a check changes them. */
  onChange(slips: Slip[]): void;
  /**
   * The page's LLM health, shared by all its Fields: whether text may go to the
   * LLM, and when it works again. Without it, or without `engines.llm`, only
   * LanguageTool runs.
   */
  llmHealth?: PageLlmHealth;
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
   * `neverFlag` is the spans of `text` that never get a Slip: any Slip
   * touching one is dropped, so it is never drawn or tallied. Pass the spans
   * of this text on every call; they are not followed through edits.
   * While `composing` (an IME has uncommitted text in the field) the edit is
   * still followed, but neither Engine checks until an update arrives with
   * `composing` false, which then checks even if the text did not change.
   */
  update(text: string, options?: { neverFlag?: readonly TextSpan[]; composing?: boolean }): Slip[];
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
/** The first wait after an LLM check that never reached the LLM; it doubles each time, up to the LLM pause. */
const UNREACHED_RETRY_MS = 5_000;
/** LanguageTool's free tier rejects requests over 20k characters. */
const MAX_REQUEST_CHARS = 20_000;

/**
 * Connects a Field's Slip tracker to one check scheduler per Engine, and
 * reports Slips to the Tally as their sentences settle.
 */
export function createFieldChecker(options: FieldCheckerOptions): FieldChecker {
  const tracker = createSlipTracker();
  let disposed = false;
  /** Keys of the Slips already passed to `onSlipsSeen`. */
  const reported = new Set<string>();
  /** LLM results by sentence text, so an unchanged sentence is never sent twice. */
  const sentenceCache = createSentenceCache();

  const languageTool = createCheckScheduler({
    debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    prepareRun() {
      if (options.site && isSiteDisabled(options.site.hostname, options.site.settings())) {
        tracker.clearDirty();
        return false;
      }
      return true;
    },
    run: () => checkDirtyParagraphs(),
  });

  /** The LLM leg: its engine and the page's health, which the leg cannot run without. */
  const llm = options.engines.llm && options.llmHealth && { engine: options.engines.llm, health: options.llmHealth };
  /** How long to wait after the next LLM check that never reaches the LLM. */
  let unreachedRetryMs = UNREACHED_RETRY_MS;
  const llmScheduler =
    llm &&
    createCheckScheduler({
      debounceMs: options.llmDebounceMs ?? DEFAULT_LLM_DEBOUNCE_MS,
      prepareRun() {
        if (!llm.health.mayCheck().allowed) {
          // Consent or the key withdrawn, or the site excluded or disabled, since the last check: drop what the LLM found.
          if (tracker.clearSlips('llm')) notify();
          return false;
        }
        // Another Provider's answers, or answers for another Mixed-in language, would not be this check's.
        const settings = options.site?.settings();
        sentenceCache.useAnswersOf(settings && `${settings.llmProvider}:${settings.mixedInLanguage}`);
        return true;
      },
      run: () => checkSentences(llm.engine),
    });
  const stopWatchingLlmHealth = llm?.health.watch((health) => {
    if (disposed) return;
    // Slips held back for the LLM count now that it can't check their sentence.
    if (health.state === 'failing') reportSightings(slips());
    // The LLM works again, maybe after another field's check: no need to sit out this field's pause.
    if (health.state === 'active') llmScheduler?.unblock();
  });

  /** Whether an update arrived while composing, so the next one that is not owes a check. */
  let held = false;

  function update(next: string, updateOptions?: { neverFlag?: readonly TextSpan[]; composing?: boolean }): Slip[] {
    tracker.setNeverFlag(updateOptions?.neverFlag ?? []);
    const changed = tracker.applyEdit(next);
    if (updateOptions?.composing) {
      held = true;
      languageTool.cancel();
      llmScheduler?.cancel();
      return slips();
    }
    if (!changed && !held) return slips();
    held = false;
    languageTool.schedule();
    llmScheduler?.schedule();
    return slips();
  }

  /** The tracker's merged Slips, with the Dictionary applied. */
  function slips(): Slip[] {
    const settings = options.site?.settings();
    return tracker.slips(settings && ((word) => isInDictionary(word, settings)));
  }

  /** Puts LanguageTool's Slips in place for each paragraph the dirty span touches. */
  async function checkDirtyParagraphs(): Promise<void> {
    const startVersion = tracker.version();
    const dirty = tracker.dirty();
    if (!dirty) return;

    const text = tracker.text();
    const targets = splitParagraphs(text).filter(
      (paragraph) => paragraph.start <= dirty.end && paragraph.end >= dirty.start,
    );

    for (const paragraph of targets) {
      let found: Slip[] = [];
      const paragraphText = text.slice(paragraph.start, paragraph.end);
      if (paragraphText.trim()) {
        try {
          found = await options.engines.languageTool.check(paragraphText);
        } catch (error) {
          if (error instanceof RateLimitedError) {
            // Re-check this paragraph once the block ends.
            if (tracker.version() === startVersion) tracker.moveDirtyStart(paragraph.start);
            languageTool.blockFor(Math.max(error.retryAfterMs ?? DEFAULT_RETRY_MS, MIN_RETRY_MS));
          }
          // Any other failure is left for the next edit to retry.
          return;
        }
        // The text moved on while we waited; the newer edit has its own check queued.
        if (tracker.version() !== startVersion || disposed) return;
      }

      tracker.replaceSlips('languagetool', paragraph, found, { dropTouching: true });
      const left = tracker.dirty();
      if (left && left.end > paragraph.end) tracker.moveDirtyStart(paragraph.end);
      else tracker.clearDirty();
      notify();
    }
    tracker.clearDirty();
  }

  /** Puts each Finished sentence's LLM Slips in place, asking the LLM only about uncached ones. */
  async function checkSentences(engine: Engine): Promise<void> {
    const startVersion = tracker.version();
    const text = tracker.text();
    for (const sentence of finishedSentences(text)) {
      const sentenceText = text.slice(sentence.start, sentence.end);
      let found = sentenceCache.get(sentenceText);
      if (!found) {
        try {
          found = await engine.check(sentenceText);
        } catch (error) {
          if (error instanceof LlmFailedError) {
            // The worker's gate pauses the LLM after a failure, says for how long, and tells the page's LLM health why.
            llmScheduler!.blockFor(error.retryAfterMs ?? LLM_FAILURE_PAUSE_MS);
          } else {
            // The check never reached the LLM (the worker turned it away, or the page lost the worker), so the
            // LLM's health is unknown: try again soon, and less often while it keeps happening.
            llmScheduler!.blockFor(unreachedRetryMs);
            unreachedRetryMs = Math.min(unreachedRetryMs * 2, LLM_FAILURE_PAUSE_MS);
          }
          return;
        }
        unreachedRetryMs = UNREACHED_RETRY_MS;
        sentenceCache.set(sentenceText, found);
        // The text moved on; the newer edit has its own check queued, which will hit the cache.
        if (tracker.version() !== startVersion || disposed) return;
      }

      tracker.replaceSlips('llm', sentence, found);
      notify();
    }
  }

  function ignore(id: string): Slip[] {
    tracker.ignore(id);
    return notify();
  }

  /** Passes the field's current Slips to `onChange`, and reports any newly settled ones. */
  function notify(): Slip[] {
    const current = slips();
    options.onChange(current);
    reportSightings(current);
    return current;
  }

  /**
   * Reports each Slip not reported before whose sentence is finished and,
   * while the LLM is active, has been checked by it (so is in the sentence cache).
   */
  function reportSightings(current: Slip[]): void {
    if (!options.onSlipsSeen) return;
    const waitForLlm = llm?.health.health().state === 'active';
    const text = tracker.text();
    const sightings: SlipSighting[] = [];
    for (const sentence of finishedSentences(text)) {
      const sentenceText = text.slice(sentence.start, sentence.end);
      if (waitForLlm && !sentenceCache.has(sentenceText)) continue;
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

  function dispose(): void {
    disposed = true;
    stopWatchingLlmHealth?.();
    languageTool.dispose();
    llmScheduler?.dispose();
  }

  return { update, slips, ignore, forgetReported: () => reported.clear(), dispose };
}

/**
 * The LLM's Slips by sentence text, for one Provider and Mixed-in language at
 * a time. Keeps itself bounded on long-lived fields by forgetting the oldest
 * sentence first.
 */
function createSentenceCache() {
  const cache = new Map<string, Slip[]>();
  /** Names the Provider and Mixed-in language the cached results came from. */
  let cacheSource: string | undefined;
  return {
    get: (sentenceText: string) => cache.get(sentenceText),
    has: (sentenceText: string) => cache.has(sentenceText),
    set(sentenceText: string, found: Slip[]): void {
      cache.set(sentenceText, found);
      if (cache.size > MAX_CACHED_SENTENCES) cache.delete(cache.keys().next().value!);
    },
    /** Empties the cache when `source` is not the one its results came from. */
    useAnswersOf(source: string | undefined): void {
      if (source === cacheSource) return;
      cache.clear();
      cacheSource = source;
    },
  };
}

/** Paragraphs are separated by blank lines; oversized ones are cut to fit one request. */
function splitParagraphs(text: string): TextSpan[] {
  const paragraphs: TextSpan[] = [];
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
 * The Finished sentences, ready for the LLM and the Tally: those
 * ending in `.`, `?` or `!` (plus any closing quotes or brackets) followed by
 * whitespace or the end of the text, and the unpunctuated end of any line a
 * line break has finished, without trailing whitespace. A sentence never spans
 * a line break, so only the unfinished last line is skipped.
 */
function finishedSentences(text: string): TextSpan[] {
  const sentences: TextSpan[] = [];
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
