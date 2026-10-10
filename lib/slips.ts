export const SLIP_KINDS = ['spelling', 'grammar', 'wording'] as const;

export type SlipKind = (typeof SLIP_KINDS)[number];

export type SlipSource = 'languagetool' | 'llm';

export interface Slip {
  id: string;
  start: number;
  end: number;
  kind: SlipKind;
  type: string;
  explanation: string;
  suggestions: string[];
  source: SlipSource;
}

/**
 * Stable across re-checks of the same Slip: derived from the kind and the
 * flagged text, not its position, so the id survives the text shifting around it.
 */
export function makeSlipId(kind: SlipKind, spanText: string): string {
  return `${kind}:${hash(spanText.toLowerCase())}`;
}

/**
 * Tells distinct Slips apart for the Popup's counts: the same Slip in the
 * same sentence keeps its key across re-checks, fields and page loads.
 */
export function makeSightingKey(kind: SlipKind, sentenceText: string, spanText: string): string {
  return `${kind}:${hash(sentenceText)}:${hash(spanText.toLowerCase())}`;
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}
