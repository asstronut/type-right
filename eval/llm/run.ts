/**
 * Runs the fixtures through the real LLM and prompt and prints recall and
 * false positives: the English cases with Mixed-in language None, the mixed
 * Indonesian–English cases with it set to Indonesian. Not part of `npm test`: it needs an API key and network.
 *
 *   npm run eval:llm [provider id, default gemini]
 *
 * The key is read from the provider's variable in KEY_VARIABLES, in the environment or `.env.local`.
 */
import { LlmFailedError, type Engine } from '../../lib/engine';
import { createLlmEngine } from '../../lib/engines/llm';
import { isLlmProviderId, LLM_PROVIDERS, type LlmProviderId } from '../../lib/llm-providers';
import type { MixedInLanguage } from '../../lib/settings';
import type { Slip } from '../../lib/slips';
import { FIXTURE, MIXED_FIXTURE } from './fixture';
import { scoreCase, type FixtureCase } from './score';

/** The environment variable holding each provider's API key. */
const KEY_VARIABLES: Record<LlmProviderId, string> = { gemini: 'GEMINI_API_KEY', glm: 'Z_AI_API_KEY' };
/** How long to wait before retrying when the key's quota runs out, and how often. */
const QUOTA_WAIT_MS = 30_000;
const QUOTA_RETRIES = 3;

const providerId = process.argv[2] ?? 'gemini';
if (!isLlmProviderId(providerId)) fail(`Unknown provider "${providerId}". Use one of: ${Object.keys(LLM_PROVIDERS).join(', ')}`);

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local: the key may be in the environment.
}
const keyVariable = KEY_VARIABLES[providerId];
const apiKey = process.env[keyVariable];
if (!apiKey) fail(`Set ${keyVariable} in the environment or .env.local.`);

console.log(`Provider: ${LLM_PROVIDERS[providerId].name} (${LLM_PROVIDERS[providerId].model})\n`);

const groups = [
  { title: 'English, Mixed-in language None', fixture: FIXTURE, mixedIn: 'none' },
  { title: 'English with Indonesian, Mixed-in language Indonesian', fixture: MIXED_FIXTURE, mixedIn: 'indonesian' },
] as const satisfies readonly { title: string; fixture: FixtureCase[]; mixedIn: MixedInLanguage }[];

const summaries: string[] = [];
for (const group of groups) summaries.push(await runGroup(group.title, group.fixture, createLlmEngine(providerId, apiKey, group.mixedIn)));
console.log(summaries.join('\n'));

/** Checks every case of `fixture` with `engine`, printing each result; returns the group's summary. */
async function runGroup(title: string, fixture: FixtureCase[], engine: Engine): Promise<string> {
  console.log(`== ${title}\n`);

  let expectedTotal = 0;
  let foundTotal = 0;
  let wrongKindTotal = 0;
  let expectedWithKind = 0;
  let falsePositiveTotal = 0;
  let overlappingTotal = 0;
  let correctSentences = 0;
  let correctSentencesFlagged = 0;
  let failures = 0;

  for (const [index, fixtureCase] of fixture.entries()) {
    console.log(`${index + 1}. ${fixtureCase.sentence}`);
    if (fixtureCase.corrected) console.log(`   corrected: ${fixtureCase.corrected}`);

    const slips = await check(engine, fixtureCase.sentence);
    if (slips instanceof LlmFailedError) {
      failures++;
      console.log(`   FAILED: ${slips.failure}\n`);
      continue;
    }

    const score = scoreCase(fixtureCase, slips);
    expectedTotal += fixtureCase.expected.length;
    foundTotal += score.found.length;
    wrongKindTotal += score.wrongKind.length;
    expectedWithKind += fixtureCase.expected.filter((e) => e.kind).length;
    falsePositiveTotal += score.falsePositives;
    overlappingTotal += score.overlapping;
    if (fixtureCase.expected.length === 0) {
      correctSentences++;
      if (slips.length > 0) correctSentencesFlagged++;
    }

    for (const slip of slips) {
      const quote = fixtureCase.sentence.slice(slip.start, slip.end);
      console.log(`   reported: "${quote}" → "${slip.suggestions[0]}" (${slip.kind}: ${slip.type})`);
    }
    for (const e of score.missed) console.log(`   MISSED:   "${e.quote}" → "${e.correction}"`);
    for (const e of score.wrongKind) console.log(`   WRONG KIND: "${e.quote}" is not reported as ${e.kind}`);
    const notes = [
      fixtureCase.expected.length > 0 && `found ${score.found.length}/${fixtureCase.expected.length}`,
      score.wrongKind.length > 0 && `${score.wrongKind.length} wrong kind`,
      score.falsePositives > 0 && `${score.falsePositives} false positive(s)`,
      score.overlapping > 0 && `${score.overlapping} overlapping`,
    ].filter(Boolean);
    console.log(`   ${notes.length > 0 ? notes.join(', ') : 'no Slips, correct'}\n`);
  }

  const percent = (n: number, of: number) => (of === 0 ? '-' : `${Math.round((100 * n) / of)}%`);
  return [
    `Summary: ${title}`,
    `  Recall:            ${foundTotal}/${expectedTotal} expected Slips found (${percent(foundTotal, expectedTotal)})`,
    expectedWithKind > 0 && `  Wrong Kind:        ${wrongKindTotal}/${expectedWithKind} found, but not as the expected Kind`,
    `  False positives:   ${falsePositiveTotal} reported Slips matching nothing expected`,
    `  Correct sentences: ${correctSentencesFlagged}/${correctSentences} flagged`,
    `  Overlapping Slips: ${overlappingTotal} (more than one correction for the same words)`,
    failures > 0 && `  Failed requests:   ${failures}/${fixture.length} (not scored)`,
    '',
  ]
    .filter((line) => line !== false)
    .join('\n');
}

/** The sentence's Slips, waiting out the key's quota a few times; any other failure is returned. */
async function check(engine: Engine, sentence: string): Promise<Slip[] | LlmFailedError> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await engine.check(sentence);
    } catch (error) {
      if (!(error instanceof LlmFailedError)) throw error;
      if (error.failure !== 'quota' || attempt === QUOTA_RETRIES) return error;
      console.log(`   quota reached, waiting ${QUOTA_WAIT_MS / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, QUOTA_WAIT_MS));
    }
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
