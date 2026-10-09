import { describe, expect, it } from 'vitest';
import { addToTally, EMPTY_TALLY, normalizeTally } from './error-tally';

describe('error tally', () => {
  it('keeps counting after a stored tally is read back', () => {
    const stored = JSON.parse(JSON.stringify(addToTally(EMPTY_TALLY, [{ key: 'a', kind: 'grammar', type: 'Article' }])));

    const next = addToTally(normalizeTally(stored), [
      { key: 'a', kind: 'grammar', type: 'Article' },
      { key: 'b', kind: 'grammar', type: 'Article' },
    ]);

    expect(next.counts).toEqual({ grammar: { Article: 2 } });
  });

  it('reads a missing or malformed stored tally as empty', () => {
    expect(normalizeTally(undefined)).toEqual(EMPTY_TALLY);
    expect(normalizeTally({ seen: 'x', counts: { spelling: { Typo: -1 }, bogus: { X: 1 } } })).toEqual(EMPTY_TALLY);
  });
});
