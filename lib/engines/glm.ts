import { makeErrorId, type CheckError, type ErrorKind } from '../errors';
import { RateLimitedError, type Engine } from '../engine';

/** Z.ai's OpenAI-compatible chat completions endpoint. */
export const GLM_API_URL = 'https://api.z.ai/api/paas/v4/chat/completions';
export const GLM_MODEL = 'glm-4.7-flash';

export interface GlmConfig {
  apiKey: string;
}

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

interface LlmError {
  quote: string;
  kind: ErrorKind;
  type: string;
  explanation: string;
  correction: string;
}

const KINDS: readonly unknown[] = ['spelling', 'grammar', 'wording'] satisfies ErrorKind[];

export function createGlmEngine(config: GlmConfig): Engine {
  return {
    async check(sentence: string): Promise<CheckError[]> {
      const response = await fetch(GLM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: GLM_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: sentence },
          ],
          temperature: 0.1,
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
        }),
      });

      if (response.status === 429) throw new RateLimitedError();
      if (!response.ok) throw new Error(`GLM request failed: ${response.status}`);

      const data = (await response.json()) as ChatCompletion;
      return locateErrors(sentence, parseErrors(data.choices?.[0]?.message?.content));
    },
  };
}

/** The well-formed Errors in the model's reply; a reply that isn't valid JSON yields none. */
function parseErrors(content: string | undefined): LlmError[] {
  if (!content) return [];
  let data: unknown;
  try {
    data = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return [];
  }
  const errors = (data as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (e): e is LlmError =>
      typeof e === 'object' &&
      e !== null &&
      typeof e.quote === 'string' &&
      e.quote.length > 0 &&
      KINDS.includes(e.kind) &&
      typeof e.type === 'string' &&
      typeof e.explanation === 'string' &&
      typeof e.correction === 'string',
  );
}

/**
 * Places each Error at its quoted text in the sentence. The same quote listed
 * more than once takes successive occurrences; quotes that aren't found are dropped.
 */
function locateErrors(sentence: string, errors: LlmError[]): CheckError[] {
  const used = new Map<string, number>();
  return errors.flatMap((error) => {
    const nth = used.get(error.quote) ?? 0;
    used.set(error.quote, nth + 1);
    const start = occurrences(sentence, error.quote)[nth];
    if (start === undefined) return [];
    return [
      {
        id: makeErrorId(error.kind, error.quote),
        start,
        end: start + error.quote.length,
        kind: error.kind,
        type: error.type,
        explanation: error.explanation,
        suggestions: [error.correction],
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
