import type { LlmFailure } from './engine';
import type { CheckError } from './errors';

/** Asks the background worker to run an engine: LanguageTool on a paragraph, or the LLM on one complete sentence. */
export interface CheckMessage {
  type: 'check-field' | 'check-sentence';
  text: string;
}

export type CheckResponse =
  | { ok: true; errors: CheckError[] }
  | { ok: false; reason: 'rate-limited'; retryAfterMs?: number }
  | { ok: false; reason: 'llm-failed'; failure: LlmFailure }
  | { ok: false; reason: 'failed' };
