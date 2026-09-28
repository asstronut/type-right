import type { CheckError } from './errors';

export interface CheckFieldMessage {
  type: 'check-field';
  text: string;
}

export interface CheckFieldResponse {
  errors: CheckError[];
}
