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
