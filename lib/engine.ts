import type { CheckError } from './errors';

export interface Engine {
  check(text: string): Promise<CheckError[]>;
}
