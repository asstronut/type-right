import type { CheckError } from './errors';

export interface Engine {
  check(text: string): Promise<CheckError[]>;
}

/** The engine's provider asked us to slow down; the check should be retried later, silently. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs?: number) {
    super('Engine rate-limited the request');
    this.name = 'RateLimitedError';
  }
}

/** Why the LLM could not check a sentence. */
export type LlmFailure = 'no-key' | 'quota' | 'network' | 'timeout' | 'bad-response';

/** The LLM request failed for a known reason, shown to the user on the field's LLM badge. */
export class LlmFailedError extends Error {
  constructor(readonly failure: LlmFailure) {
    super(`LLM check failed: ${failure}`);
    this.name = 'LlmFailedError';
  }
}
