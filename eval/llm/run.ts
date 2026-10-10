/**
 * Runs the fixture through the real LLM and prompt and prints recall and
 * false positives. Not part of `npm test`: it needs an API key and network.
 *
 *   npm run eval:llm [gemini|glm]
 *
 * The key is read from GEMINI_API_KEY or Z_AI_API_KEY, in the environment or `.env.local`.
 */
import { LlmFailedError } from '../../lib/engine';
import { createLlmEngine } from '../../lib/engines/llm';
import { isLlmProviderId, LLM_PROVIDERS, type LlmProviderId } from '../../lib/llm-providers';
import type { Slip } from '../../lib/slips';
import { FIXTURE } from './fixture';
import { scoreCase } from './score';

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

const engine = createLlmEngine(providerId, apiKey);
console.log(`Provider: ${LLM_PROVIDERS[providerId].name} (${LLM_PROVIDERS[providerId].model})\n`);

let expectedTotal = 0;
let foundTotal = 0;
let falsePositiveTotal = 0;
let overlappingTotal = 0;
let correctSentences = 0;
let correctSentencesFlagged = 0;
let failures = 0;

for (const [index, fixture] of FIXTURE.entries()) {
  console.log(`${index + 1}. ${fixture.sentence}`);
  if (fixture.corrected) console.log(`   corrected: ${fixture.corrected}`);

  const slips = await check(fixture.sentence);
  if (slips instanceof LlmFailedError) {
    failures++;
    console.log(`   FAILED: ${slips.failure}\n`);
    continue;
  }

  const score = scoreCase(fixture, slips);
  expectedTotal += fixture.expected.length;
  foundTotal += score.found.length;
  falsePositiveTotal += score.falsePositives;
  overlappingTotal += score.overlapping;
  if (fixture.expected.length === 0) {
    correctSentences++;
    if (slips.length > 0) correctSentencesFlagged++;
  }

  for (const slip of slips) {
    const quote = fixture.sentence.slice(slip.start, slip.end);
    console.log(`   reported: "${quote}" → "${slip.suggestions[0]}" (${slip.type})`);
  }
  for (const e of score.missed) console.log(`   MISSED:   "${e.quote}" → "${e.correction}"`);
  const notes = [
    fixture.expected.length > 0 && `found ${score.found.length}/${fixture.expected.length}`,
    score.falsePositives > 0 && `${score.falsePositives} false positive(s)`,
    score.overlapping > 0 && `${score.overlapping} overlapping`,
  ].filter(Boolean);
  console.log(`   ${notes.length > 0 ? notes.join(', ') : 'no Slips, correct'}\n`);
}

const percent = (n: number, of: number) => (of === 0 ? '-' : `${Math.round((100 * n) / of)}%`);
console.log('Summary');
console.log(`  Recall:            ${foundTotal}/${expectedTotal} expected Slips found (${percent(foundTotal, expectedTotal)})`);
console.log(`  False positives:   ${falsePositiveTotal} reported Slips matching nothing expected`);
console.log(`  Correct sentences: ${correctSentencesFlagged}/${correctSentences} flagged`);
console.log(`  Overlapping Slips: ${overlappingTotal} (more than one correction for the same words)`);
if (failures > 0) console.log(`  Failed requests:   ${failures}/${FIXTURE.length} (not scored)`);

/** The sentence's Slips, waiting out the key's quota a few times; any other failure is returned. */
async function check(sentence: string): Promise<Slip[] | LlmFailedError> {
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
