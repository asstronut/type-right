import type { CheckError } from './errors';

/** Asks the background worker to run LanguageTool on a paragraph. */
export interface CheckFieldMessage {
  type: 'check-field';
  text: string;
}

/** Asks the background worker to run the LLM on one complete sentence. */
export interface CheckSentenceMessage {
  type: 'check-sentence';
  text: string;
}

export type CheckFieldResponse =
  | { ok: true; errors: CheckError[] }
  | { ok: false; reason: 'rate-limited'; retryAfterMs?: number }
  | { ok: false; reason: 'failed' };
