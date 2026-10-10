import type { LlmFailure } from './engine';
import type { LlmFailureRecord } from './llm-failure';
import type { Slip } from './slips';
import type { SlipSighting } from './slip-tally';

/** Asks the background worker to run an engine: LanguageTool on a paragraph, or the LLM on one finished sentence. */
export interface CheckMessage {
  type: 'check-field' | 'check-sentence';
  text: string;
}

export type CheckResponse =
  | { ok: true; slips: Slip[] }
  | { ok: false; reason: 'rate-limited'; retryAfterMs?: number }
  | { ok: false; reason: 'llm-failed'; failure: LlmFailure; retryAfterMs?: number }
  | { ok: false; reason: 'failed' };

/**
 * Asks the background worker to add newly seen Slips to the Popup's counts,
 * or to reset them; it applies these one at a time.
 */
export type TallyMessage = { type: 'record-slips'; sightings: SlipSighting[] } | { type: 'reset-tally' };

/**
 * The background worker tells every tab that the LLM's failure changed: why
 * and with which Provider and key it fails now, or null after a success.
 */
export interface LlmFailureMessage {
  type: 'llm-failure';
  failure: LlmFailureRecord | null;
}

/** A tab asks the background worker why the LLM fails right now. */
export interface LlmFailureQuery {
  type: 'get-llm-failure';
}

/** The LLM's current failure with the current Provider and key, or null when it isn't failing. */
export type LlmFailureResponse = LlmFailureRecord | null;
