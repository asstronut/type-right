export const CYCLE_WORDS = ['recieve', 'teh', 'occured', 'seperate', 'definately', 'untill', 'wierd', 'beleive'];

const TYPO_WORDS = [...CYCLE_WORDS, 'diffrence', 'remaning', 'expensiv', 'carefull'];

const wordPattern = (words) => new RegExp(`\\b(?:${words.join('|')})\\b`, 'g');

export function countCycleWords(text) {
  return (text.match(wordPattern(CYCLE_WORDS)) ?? []).length;
}

export function hasStubWord(text) {
  return wordPattern(TYPO_WORDS).test(text);
}

const SUBJECTS = ['The review team', 'Our support desk', 'The release manager', 'A new teammate', 'The finance group', 'Every volunteer', 'The night shift'];
const OBJECTS = [
  'the quarterly figures',
  'a draft of the handbook',
  'the shipping labels',
  "last weekend's feedback",
  'the budget summary',
  'two open tickets',
  'the onboarding notes',
  'a long email thread',
  'the vendor contract',
  'the updated roadmap',
  'our meeting minutes',
];
const TAILS = [
  'before the stand-up',
  'while the office was quiet',
  'in time for Friday planning',
  'and left a short comment for everyone',
  'so nothing blocks Monday',
];

export const FILLER =
  'The report covers the last four weeks of support tickets, grouped by product area. Start with the summary and skip the appendix unless something looks off.';

export const LONG_PARAGRAPH_COUNT = 500;

export function longParagraphs(count = LONG_PARAGRAPH_COUNT) {
  let word = 0;
  const nextWord = () => CYCLE_WORDS[word++ % CYCLE_WORDS.length];
  return Array.from({ length: count }, (_, i) => {
    const subject = SUBJECTS[i % SUBJECTS.length];
    const object = OBJECTS[(i * 3) % OBJECTS.length];
    const tail = TAILS[(i * 2) % TAILS.length];
    const clause = i % 5 < 3 ? ` and will ${nextWord()} it again` : '';
    return `${i + 1}. ${subject} had to ${nextWord()} ${object}${clause} ${tail}.`;
  });
}
