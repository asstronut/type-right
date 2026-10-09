import type { LlmFailure } from './engine';
import type { CheckError } from './errors';
import type { ErrorSighting } from './error-tally';

/** Asks the background worker to run an engine: LanguageTool on a paragraph, or the LLM on one finished sentence. */
export interface CheckMessage {
  type: 'check-field' | 'check-sentence';
  text: string;
}

export type CheckResponse =
  | { ok: true; errors: CheckError[] }
  | { ok: false; reason: 'rate-limited'; retryAfterMs?: number }
  | { ok: false; reason: 'llm-failed'; failure: LlmFailure }
  | { ok: false; reason: 'failed' };

/**
 * Asks the background worker to add newly seen Errors to the Popup's counts,
 * or to reset them; it applies these one at a time.
 */
export type TallyMessage = { type: 'record-errors'; sightings: ErrorSighting[] } | { type: 'reset-tally' };
