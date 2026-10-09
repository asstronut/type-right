export const ERROR_KINDS = ['spelling', 'grammar', 'wording'] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export type ErrorSource = 'languagetool' | 'llm';

export interface CheckError {
  id: string;
  start: number;
  end: number;
  kind: ErrorKind;
  type: string;
  explanation: string;
  suggestions: string[];
  source: ErrorSource;
}

/**
 * Stable across re-checks of the same mistake: derived from the kind and the
 * flagged text, not its position, so the id survives the text shifting around it.
 */
export function makeErrorId(kind: ErrorKind, spanText: string): string {
  return `${kind}:${hash(spanText.toLowerCase())}`;
}

/**
 * Tells distinct Errors apart for the Popup's counts: the same mistake in the
 * same sentence keeps its key across re-checks, fields and page loads.
 */
export function makeSightingKey(kind: ErrorKind, sentenceText: string, spanText: string): string {
  return `${kind}:${hash(sentenceText)}:${hash(spanText.toLowerCase())}`;
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}
