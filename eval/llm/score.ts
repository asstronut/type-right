/** A Slip the LLM should find, as the words it covers. */
export interface ExpectedSlip {
  /** The wrong words, copied from the sentence. Matched as whole words. */
  quote: string;
  /** Which whole-word occurrence of `quote`, when it appears more than once. Defaults to 0. */
  nth?: number;
  /** What a native speaker would write instead; for reading the results only. */
  correction: string;
}

export interface FixtureCase {
  sentence: string;
  /** Empty for a correct sentence, which must produce no Slips. */
  expected: ExpectedSlip[];
  /** The whole sentence corrected, when it helps to read the results. */
  corrected?: string;
}

export interface Span {
  start: number;
  end: number;
}

export interface CaseScore {
  /** Expected Slips that some reported Slip overlaps. */
  found: ExpectedSlip[];
  missed: ExpectedSlip[];
  /** Reported Slips that overlap no expected Slip. */
  falsePositives: number;
  /** Reported Slips that overlap an earlier reported Slip: more than one correction for the same words. */
  overlapping: number;
}

/** Where `expected` is in `sentence`; throws when the fixture quotes words that aren't there. */
export function spanOf(sentence: string, expected: ExpectedSlip): Span {
  const nth = expected.nth ?? 0;
  const start = wholeWordOccurrences(sentence, expected.quote)[nth];
  if (start === undefined) {
    throw new Error(`Fixture quote "${expected.quote}" #${nth} is not in: ${sentence}`);
  }
  return { start, end: start + expected.quote.length };
}

export function scoreCase(fixture: FixtureCase, reported: Span[]): CaseScore {
  const expectedSpans = fixture.expected.map((e) => spanOf(fixture.sentence, e));
  const found = fixture.expected.filter((_, i) => reported.some((r) => overlaps(r, expectedSpans[i]!)));
  return {
    found,
    missed: fixture.expected.filter((e) => !found.includes(e)),
    falsePositives: reported.filter((r) => !expectedSpans.some((e) => overlaps(r, e))).length,
    overlapping: reported.filter((r, i) => reported.slice(0, i).some((earlier) => overlaps(r, earlier))).length,
  };
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function wholeWordOccurrences(sentence: string, quote: string): number[] {
  const all: number[] = [];
  for (let at = sentence.indexOf(quote); at !== -1; at = sentence.indexOf(quote, at + 1)) {
    const before = sentence[at - 1];
    const after = sentence[at + quote.length];
    if (!(isWordChar(quote[0]) && isWordChar(before)) && !(isWordChar(quote.at(-1)) && isWordChar(after))) {
      all.push(at);
    }
  }
  return all;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_'’]/u.test(char);
}
