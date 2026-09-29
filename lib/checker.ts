import type { CheckError } from './errors';
import type { Engine } from './engine';

export interface CheckEngines {
  languageTool: Engine;
}

export async function checkText(text: string, engines: CheckEngines): Promise<CheckError[]> {
  if (!text.trim()) return [];
  return engines.languageTool.check(text);
}
