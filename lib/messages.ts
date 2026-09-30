import type { CheckError } from './errors';

export interface CheckFieldMessage {
  type: 'check-field';
  text: string;
}

export type CheckFieldResponse =
  | { ok: true; errors: CheckError[] }
  | { ok: false; reason: 'rate-limited'; retryAfterMs?: number }
  | { ok: false; reason: 'failed' };
