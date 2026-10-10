import { SLIP_KINDS, makeSlipId, type Slip, type SlipKind } from '../slips';
import { LlmFailedError, type Engine } from '../engine';
import { LLM_PROVIDERS, type LlmProvider, type LlmProviderId } from '../llm-providers';

const SYSTEM_PROMPT = `You check one English sentence written by a non-native speaker.
Find spelling mistakes, grammar mistakes, and wording that is grammatically correct but that a native speaker would not use.
Do not flag style, tone or punctuation preferences. Do not flag anything that is correct and natural.

Reply with JSON only, no other text, in exactly this shape:
{"errors":[{"quote":"...","kind":"spelling|grammar|wording","type":"...","explanation":"...","correction":"..."}]}

- quote: the wrong words, copied exactly from the sentence (same letters and case), as short as possible while covering the mistake.
- kind: "spelling", "grammar", or "wording" (correct but unnatural).
- type: a short label for the kind of mistake, e.g. "Verb tense", "Missing article", "Preposition", "Unnatural wording".
- explanation: one or two sentences in simple English saying why it is wrong.
- correction: the text that should replace quote.

If the sentence has no mistakes, reply {"errors":[]}.`;

interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
}

interface LlmSlip {
  quote: string;
  kind: SlipKind;
  type: string;
  explanation: string;
  correction: string;
}

/** A check, fallback model included, is abandoned after this long. */
const TIMEOUT_MS = 8_000;

/**
 * The LLM engine for `providerId`, sending each sentence with `apiKey`. Every
 * failure is thrown as an LlmFailedError saying why.
 */
export function createLlmEngine(providerId: LlmProviderId, apiKey: string): Engine {
  const provider = LLM_PROVIDERS[providerId];
  return {
    async check(sentence: string): Promise<Slip[]> {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
      try {
        return await checkWithin(provider, apiKey, sentence, timeout.signal);
      } catch (error) {
        if (error instanceof LlmFailedError) throw error;
        if (timeout.signal.aborted) throw new LlmFailedError('timeout');
        // fetch rejects with a TypeError when the server can't be reached.
        throw new LlmFailedError(error instanceof TypeError ? 'network' : 'bad-response');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function checkWithin(
  provider: LlmProvider,
  apiKey: string,
  sentence: string,
  signal: AbortSignal,
): Promise<Slip[]> {
  let response = await request(provider, apiKey, provider.model, sentence, signal);
  if (await provider.isOverloaded(response)) {
    response = await request(provider, apiKey, provider.fallbackModel, sentence, signal);
    // Overloaded too: the provider is struggling, which is not this key's quota.
    if (await provider.isOverloaded(response)) throw new LlmFailedError('bad-response');
  }

  if (response.status === 401 || response.status === 403) throw new LlmFailedError('no-key');
  if (response.status === 429) throw new LlmFailedError('quota');
  if (!response.ok) throw new LlmFailedError('bad-response');

  const choices = ((await response.json()) as ChatCompletion | null)?.choices;
  if (!Array.isArray(choices)) throw new LlmFailedError('bad-response');
  return locateSlips(sentence, parseSlips(choices[0]?.message?.content));
}

function request(
  provider: LlmProvider,
  apiKey: string,
  model: string,
  sentence: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(provider.apiUrl, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: sentence },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      ...provider.extraFields,
    }),
  });
}

/** The well-formed Slips in the model's reply; a reply that isn't valid JSON yields none. */
function parseSlips(content: string | undefined): LlmSlip[] {
  if (!content) return [];
  let data: unknown;
  try {
    data = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return [];
  }
  // The prompt asks for `errors`, the word the model knows best; they are Slips here.
  const slips = (data as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(slips)) return [];
  return slips.filter(
    (e): e is LlmSlip =>
      typeof e === 'object' &&
      e !== null &&
      typeof e.quote === 'string' &&
      e.quote.length > 0 &&
      (SLIP_KINDS as readonly unknown[]).includes(e.kind) &&
      typeof e.type === 'string' &&
      typeof e.explanation === 'string' &&
      typeof e.correction === 'string',
  );
}

/**
 * Places each Slip at its quoted text in the sentence. The same quote listed
 * more than once takes successive occurrences; quotes that aren't found are dropped.
 */
function locateSlips(sentence: string, slips: LlmSlip[]): Slip[] {
  const used = new Map<string, number>();
  return slips.flatMap((slip) => {
    const nth = used.get(slip.quote) ?? 0;
    used.set(slip.quote, nth + 1);
    const start = occurrences(sentence, slip.quote)[nth];
    if (start === undefined) return [];
    return [
      {
        id: makeSlipId(slip.kind, slip.quote),
        start,
        end: start + slip.quote.length,
        kind: slip.kind,
        type: slip.type,
        explanation: slip.explanation,
        suggestions: [slip.correction],
        source: 'llm' as const,
      },
    ];
  });
}

/**
 * Where `quote` appears in `sentence`, in order. Whole-word matches come
 * first, so `is` is found as a word rather than inside `This`.
 */
function occurrences(sentence: string, quote: string): number[] {
  const all: number[] = [];
  for (let at = sentence.indexOf(quote); at !== -1; at = sentence.indexOf(quote, at + 1)) all.push(at);
  const isWholeWord = (at: number) =>
    !(isWordChar(quote[0]) && isWordChar(sentence[at - 1])) &&
    !(isWordChar(quote.at(-1)) && isWordChar(sentence[at + quote.length]));
  return [...all.filter(isWholeWord), ...all.filter((at) => !isWholeWord(at))];
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_'’]/u.test(char);
}
