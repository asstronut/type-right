import type { FixtureCase } from './score';

/**
 * Sentences with mistakes typical of non-native writers, then correct ones
 * that must produce no Slips. Each expected Slip is the words it covers.
 */
export const FIXTURE: FixtureCase[] = [
  // Tense
  { sentence: 'Yesterday I go to the office early.', expected: [{ quote: 'go', correction: 'went' }] },
  { sentence: 'I am living in Jakarta since 2019.', expected: [{ quote: 'am living', correction: 'have lived' }] },
  { sentence: 'I will call you when I will arrive.', expected: [{ quote: 'will arrive', correction: 'arrive' }] },
  { sentence: "I didn't went to the party.", expected: [{ quote: 'went', correction: 'go' }] },
  {
    sentence: 'The meeting was postponed to next week because the boss is sick yesterday.',
    expected: [{ quote: 'is sick', correction: 'was sick' }],
  },

  // Articles and countability
  { sentence: 'He gave me an useful advice.', expected: [{ quote: 'an useful advice', correction: 'some useful advice' }] },
  { sentence: 'Please send me the informations before Friday.', expected: [{ quote: 'informations', correction: 'information' }] },
  { sentence: 'I have a lot of works to finish today.', expected: [{ quote: 'works', correction: 'work' }] },
  {
    sentence: 'We need to make a research before deciding.',
    expected: [{ quote: 'make a research', correction: 'do some research' }],
  },

  // Prepositions
  { sentence: 'We discussed about the budget in the meeting.', expected: [{ quote: 'discussed about', correction: 'discussed' }] },
  { sentence: 'She is good in mathematics.', expected: [{ quote: 'good in', correction: 'good at' }] },
  { sentence: 'He is married with a doctor.', expected: [{ quote: 'married with', correction: 'married to' }] },
  { sentence: 'He arrived to the airport at 6 pm.', expected: [{ quote: 'arrived to', correction: 'arrived at' }] },
  {
    sentence: "Let's discuss this on tomorrow's meeting.",
    expected: [{ quote: "on tomorrow's", correction: "at tomorrow's" }],
  },
  { sentence: 'She has been working here since three years.', expected: [{ quote: 'since', correction: 'for' }] },

  // Agreement
  { sentence: 'There is many reasons to change the plan.', expected: [{ quote: 'There is', correction: 'There are' }] },
  { sentence: 'Each of the students have a laptop.', expected: [{ quote: 'have', correction: 'has' }] },
  { sentence: 'The datas shows a clear trend.', expected: [{ quote: 'datas shows', correction: 'data show' }] },

  // Verb patterns and word choice
  { sentence: 'I am agree with your proposal.', expected: [{ quote: 'am agree', correction: 'agree' }] },
  { sentence: 'My manager explained me the new process.', expected: [{ quote: 'explained me', correction: 'explained to me' }] },
  { sentence: 'Can you borrow me your charger?', expected: [{ quote: 'borrow', correction: 'lend' }] },
  { sentence: 'I look forward to hear from you.', expected: [{ quote: 'hear', correction: 'hearing' }] },
  {
    sentence: 'She suggested me to apply for the job.',
    expected: [{ quote: 'suggested me to apply', correction: 'suggested that I apply' }],
  },
  { sentence: "I'm interesting in learning Japanese.", expected: [{ quote: 'interesting', correction: 'interested' }] },
  { sentence: 'This is the most cheapest option we have.', expected: [{ quote: 'most cheapest', correction: 'cheapest' }] },

  // Unnatural wording
  {
    sentence: 'Thank you for your fast response, I will check it soon and revert back to you.',
    expected: [{ quote: 'revert back to you', correction: 'get back to you' }],
  },

  // Typed for real; the LLM gave several corrections for the same words.
  {
    sentence:
      "i check PR #16 and #17 have different format, the one has checklist the other one doesn't, i prefer the template has checklist.",
    expected: [
      { quote: 'i', correction: 'I' },
      { quote: 'check', correction: 'checked' },
      { quote: 'PR', correction: 'PRs' },
      { quote: 'have different format', correction: 'and they have different formats' },
      { quote: 'the one has checklist', correction: 'one has a checklist' },
      { quote: 'i', nth: 1, correction: 'I' },
      { quote: 'template has checklist', correction: 'template with a checklist' },
    ],
    corrected:
      "I checked PRs #16 and #17, and they have different formats; one has a checklist; the other one doesn't. I prefer the template with a checklist.",
  },

  // Correct: no Slips
  { sentence: 'I sent the report to the client this morning.', expected: [] },
  { sentence: 'We have been working on this feature for two weeks.', expected: [] },
  { sentence: 'Could you review my pull request when you have time?', expected: [] },
  { sentence: 'She is responsible for the marketing budget.', expected: [] },
  { sentence: 'If I had known about the delay, I would have left later.', expected: [] },
  { sentence: 'The tests pass on my machine, but they fail in CI.', expected: [] },
];
