import { describe, expect, it } from 'vitest';
import { FIXTURE } from './fixture';
import { scoreCase, spanOf, type FixtureCase } from './score';

const at = (sentence: string, quote: string) => {
  const start = sentence.indexOf(quote);
  return { start, end: start + quote.length };
};

describe('spanOf', () => {
  it('matches whole words only, by occurrence', () => {
    const sentence = 'i think this is it, i said';
    expect(spanOf(sentence, { quote: 'i', correction: 'I' })).toEqual({ start: 0, end: 1 });
    expect(spanOf(sentence, { quote: 'i', nth: 1, correction: 'I' })).toEqual({ start: 20, end: 21 });
  });

  it('throws when the quote is not in the sentence', () => {
    expect(() => spanOf('Hello there.', { quote: 'world', correction: 'x' })).toThrow();
  });

  it('locates every quote in the fixture', () => {
    for (const c of FIXTURE) for (const e of c.expected) expect(() => spanOf(c.sentence, e)).not.toThrow();
  });
});

describe('scoreCase', () => {
  const fixture: FixtureCase = {
    sentence: 'She have been working here since three years.',
    expected: [
      { quote: 'have', correction: 'has' },
      { quote: 'since', correction: 'for' },
    ],
  };

  it('counts an expected Slip as found when a reported Slip overlaps it', () => {
    const score = scoreCase(fixture, [at(fixture.sentence, 'She have')]);
    expect(score.found.map((e) => e.quote)).toEqual(['have']);
    expect(score.missed.map((e) => e.quote)).toEqual(['since']);
    expect(score.falsePositives).toBe(0);
  });

  it('counts reported Slips that overlap nothing expected as false positives', () => {
    const score = scoreCase(fixture, [at(fixture.sentence, 'working here')]);
    expect(score.falsePositives).toBe(1);
  });

  it('counts reported Slips overlapping an earlier one', () => {
    const s = fixture.sentence;
    const score = scoreCase(fixture, [at(s, 'have'), at(s, 'She have'), at(s, 'since')]);
    expect(score.overlapping).toBe(1);
    expect(score.found).toHaveLength(2);
  });

  it('treats any Slip on a correct sentence as a false positive', () => {
    const correct = { sentence: 'All good here.', expected: [] };
    expect(scoreCase(correct, [at(correct.sentence, 'good')]).falsePositives).toBe(1);
  });
});
