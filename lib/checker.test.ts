import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFieldChecker, type LlmHealth } from './checker';
import { createLanguageToolEngine } from './engines/language-tool';
import { createLlmEngine } from './engines/llm';
import type { CheckError } from './errors';
import type { LlmProviderId } from './llm-providers';
import { DEFAULT_SETTINGS, type Settings } from './settings';

const DEBOUNCE_MS = 600;
const LLM_DEBOUNCE_MS = 1500;

/** A canned LanguageTool: flags each known bad word wherever it appears in the text it receives. */
const KNOWN_MISTAKES = {
  recieve: { issueType: 'misspelling', shortMessage: 'Spelling mistake', replacement: 'receive' },
  'a apple': { issueType: 'grammar', shortMessage: 'Article', replacement: 'an apple' },
} as const;

function languageToolMatches(text: string) {
  const matches = [];
  for (const [bad, info] of Object.entries(KNOWN_MISTAKES)) {
    let from = 0;
    for (let at = text.indexOf(bad, from); at !== -1; at = text.indexOf(bad, from)) {
      matches.push({
        message: `Problem with "${bad}".`,
        shortMessage: info.shortMessage,
        offset: at,
        length: bad.length,
        replacements: [{ value: info.replacement }],
        rule: { issueType: info.issueType, category: { id: 'X', name: 'Category' } },
      });
      from = at + bad.length;
    }
  }
  return matches;
}

interface LlmMistake {
  quote: string;
  kind: string;
  type: string;
  explanation: string;
  correction: string;
}

/** How each LLM provider looks from outside the browser. */
const PROVIDERS = [
  {
    id: 'glm',
    url: 'https://api.z.ai/api/paas/v4/chat/completions',
    models: ['glm-4.7-flash', 'glm-4.5-flash'],
    /** Z.ai's reply when a model is overloaded: HTTP 429 with business code 1305. */
    overloaded: () =>
      new Response(JSON.stringify({ error: { code: '1305', message: 'The service may be temporarily overloaded' } }), {
        status: 429,
      }),
    rateLimited: () =>
      new Response(JSON.stringify({ error: { code: '1302', message: 'Rate limit reached' } }), { status: 429 }),
  },
  {
    id: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    overloaded: () =>
      new Response(
        JSON.stringify([{ error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } }]),
        { status: 503 },
      ),
    rateLimited: () =>
      new Response(
        JSON.stringify([{ error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED' } }]),
        { status: 429 },
      ),
  },
] as const satisfies readonly {
  id: LlmProviderId;
  url: string;
  models: readonly string[];
  overloaded(): Response;
  rateLimited(): Response;
}[];

const LLM_URLS: string[] = PROVIDERS.map((p) => p.url);

/** The provider the field's LLM engine talks to. */
let llmProvider: LlmProviderId;
/** Canned LLM replies, by the exact sentence sent; any other sentence gets no errors. */
let llmReplies: Record<string, string>;
/** Raw LLM responses to return (or throw), in order, before falling back to `llmReplies`. */
let llmResponses: ((init: { signal?: AbortSignal }) => Response | Promise<Response>)[];

function llmReply(errors: LlmMistake[]): string {
  return JSON.stringify({ errors });
}

function chatCompletion(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
    { status: 200 },
  );
}

/** The sentence an LLM request asks about: the last user message. */
function llmSentence(init: { body: string }): string {
  const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
  return body.messages.filter((m) => m.role === 'user').at(-1)!.content;
}

describe('createFieldChecker', () => {
  const fetchMock = vi.fn();
  let latest: CheckError[];
  let health: LlmHealth | undefined;

  function setup(site?: { hostname: string; settings: Partial<Settings> }, withLlm = false) {
    const languageTool = createLanguageToolEngine({
      apiUrl: 'https://api.languagetool.org',
      language: 'en-US',
    });
    const llm = withLlm ? createLlmEngine(llmProvider, 'test-key') : undefined;
    const checker = createFieldChecker({
      engines: { languageTool, llm },
      site: site && {
        hostname: site.hostname,
        settings: () => ({ ...DEFAULT_SETTINGS, llmProvider, ...site.settings }),
      },
      onChange: (errors) => {
        latest = errors;
      },
      onLlmHealthChange: (next) => {
        health = next;
      },
    });
    return {
      /** Type the new full text, then pause long enough for the debounced check to finish. */
      async type(text: string) {
        const immediate = checker.update(text);
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        return immediate;
      },
      /** Type the new full text, then pause long enough for the LLM check to finish too. */
      async typeAndWait(text: string) {
        const immediate = checker.update(text);
        await vi.advanceTimersByTimeAsync(LLM_DEBOUNCE_MS);
        return immediate;
      },
      update: checker.update,
      llmHealth: checker.llmHealth,
      ignore: checker.ignore,
      errors: checker.errors,
    };
  }

  /** The texts LanguageTool was asked to check, in order. */
  function sentTexts(): string[] {
    return fetchMock.mock.calls
      .filter(([url]) => !LLM_URLS.includes(url))
      .map(([, init]) => new URLSearchParams(init.body).get('text')!);
  }

  /** The LLM requests made, in order. */
  function llmCalls(): [string, { headers: Record<string, string>; body: string }][] {
    return fetchMock.mock.calls.filter(([url]) => LLM_URLS.includes(url)) as ReturnType<typeof llmCalls>;
  }

  /** The sentences the LLM was asked to check, in order. */
  function llmSent(): string[] {
    return llmCalls().map(([, init]) => llmSentence(init));
  }

  /** The models the LLM requests asked for, in order. */
  function models(): string[] {
    return llmCalls().map(([, init]) => (JSON.parse(init.body) as { model: string }).model);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    latest = [];
    health = undefined;
    llmReplies = {};
    llmResponses = [];
    llmProvider = 'glm';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string, init: { body: string; signal?: AbortSignal }) => {
      if (LLM_URLS.includes(url)) {
        const queued = llmResponses.shift();
        if (queued) return queued(init);
        return chatCompletion(llmReplies[llmSentence(init)] ?? llmReply([]));
      }
      const text = new URLSearchParams(init.body).get('text')!;
      return new Response(JSON.stringify({ matches: languageToolMatches(text) }), { status: 200 });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('returns no errors for blank text without calling the engine', async () => {
    const field = setup();

    await field.type('   ');

    expect(latest).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('produces a spelling Error with correct offsets from a canned LT response', async () => {
    const field = setup();
    const text = 'I will recieve it';
    const start = text.indexOf('recieve');

    await field.type(text);

    expect(latest).toEqual([
      {
        id: expect.any(String),
        start,
        end: start + 'recieve'.length,
        kind: 'spelling',
        type: 'Spelling mistake',
        explanation: 'Problem with "recieve".',
        suggestions: ['receive'],
        source: 'languagetool',
      },
    ]);
  });

  it('gives an LT grammar match the kind grammar', async () => {
    const field = setup();

    await field.type('She ate a apple.');

    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ kind: 'grammar', type: 'Article', source: 'languagetool' });
  });

  describe('while the user keeps typing', () => {
    it('shifts an Error right away when text is inserted before it', async () => {
      const field = setup();
      await field.type('I will recieve it');

      const immediate = field.update('Yes, I will recieve it');

      const start = 'Yes, I will recieve it'.indexOf('recieve');
      expect(immediate).toEqual([
        expect.objectContaining({ start, end: start + 'recieve'.length }),
      ]);
    });

    it('shifts an Error left when text before it is deleted', async () => {
      const field = setup();
      await field.type('Yes, I will recieve it');

      const immediate = field.update('I will recieve it');

      expect(immediate.map((e) => e.start)).toEqual(['I will recieve it'.indexOf('recieve')]);
    });

    it('leaves an Error in place when text is added after it', async () => {
      const field = setup();
      await field.type('I will recieve it');

      const immediate = field.update('I will recieve it soon');

      expect(immediate.map((e) => e.start)).toEqual([7]);
    });

    it('removes an Error immediately when an edit lands inside its words', async () => {
      const field = setup();
      await field.type('I will recieve it');

      const immediate = field.update('I will recive it');

      expect(immediate).toEqual([]);
    });

    it('removes an Error immediately when a letter is typed right at its end', async () => {
      const field = setup();
      await field.type('I will recieve it');

      const immediate = field.update('I will recieves it');

      expect(immediate).toEqual([]);
    });

    it('keeps an Error when a space is typed right after it', async () => {
      const field = setup();
      await field.type('I will recieve');

      const immediate = field.update('I will recieve ');

      expect(immediate).toHaveLength(1);
    });

    it('notifies with the re-checked Errors once the user pauses', async () => {
      const field = setup();
      await field.type('I will recieve it');

      await field.type('Yes, I will recieve it');

      expect(latest.map((e) => e.start)).toEqual(['Yes, I will recieve it'.indexOf('recieve')]);
    });

    it('does not check again until the user has paused for the debounce interval', async () => {
      const field = setup();
      field.update('I will rec');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100);
      field.update('I will recieve');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100);
      expect(fetchMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);

      expect(sentTexts()).toEqual(['I will recieve']);
    });
  });

  describe('paragraph scope', () => {
    it('sends only the paragraph being edited, not the whole field', async () => {
      const field = setup();
      const first = 'First paragraph with recieve in it.';
      const second = 'Second paragraph.';
      await field.type(`${first}\n\n${second}`);
      fetchMock.mockClear();

      await field.type(`${first}\n\n${second} More`);

      expect(sentTexts()).toEqual([`${second} More`]);
    });

    it('does not re-send anything when the text is unchanged', async () => {
      const field = setup();
      await field.type('I will recieve it');
      fetchMock.mockClear();

      await field.type('I will recieve it');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps Errors from untouched paragraphs, at their shifted offsets', async () => {
      const field = setup();
      const before = 'Intro line.';
      const flagged = 'I will recieve it.';
      await field.type(`${flagged}\n\n${before}`);

      await field.type(`${flagged}\n\n${before} And more`);

      expect(latest.map((e) => e.start)).toEqual([flagged.indexOf('recieve')]);
    });

    it('offsets Errors found in a later paragraph into whole-field coordinates', async () => {
      const field = setup();
      const intro = 'Hello there.';
      const flagged = 'I will recieve it.';

      await field.type(`${intro}\n\n${flagged}`);

      const expected = intro.length + 2 + flagged.indexOf('recieve');
      expect(latest.map((e) => e.start)).toEqual([expected]);
    });
  });

  describe('when LanguageTool rate-limits', () => {
    function rateLimitOnce(retryAfterSeconds?: string) {
      fetchMock.mockResolvedValueOnce(
        new Response('Too many requests', {
          status: 429,
          headers: retryAfterSeconds ? { 'Retry-After': retryAfterSeconds } : {},
        }),
      );
    }

    it('does not crash or wrongly clear existing Errors', async () => {
      const field = setup();
      await field.type('I will recieve it');
      const errorsBefore = latest;

      rateLimitOnce();
      await field.type('I will recieve it now');

      expect(latest.length).toBeGreaterThan(0);
      expect(errorsBefore).toHaveLength(1);
      expect(field.update('I will recieve it now')).toHaveLength(1);
    });

    it('retries the same paragraph later and then shows the result', async () => {
      const field = setup();
      rateLimitOnce('10');
      await field.type('I will recieve it');
      expect(latest).toEqual([]);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(sentTexts()).toEqual(['I will recieve it', 'I will recieve it']);
      expect(latest).toHaveLength(1);
    });

    it('waits out the rate-limit window even if the user keeps typing', async () => {
      const field = setup();
      rateLimitOnce('10');
      await field.type('I will recieve it');
      fetchMock.mockClear();

      field.update('I will recieve it!');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      expect(fetchMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(sentTexts()).toEqual(['I will recieve it!']);
    });

    it('never retries in a tight loop when Retry-After is 0', async () => {
      const field = setup();
      rateLimitOnce('0');
      await field.type('I will recieve it');
      fetchMock.mockClear();

      await vi.advanceTimersByTimeAsync(500);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('retries after a default delay when the response has no Retry-After', async () => {
      const field = setup();
      rateLimitOnce();
      await field.type('I will recieve it');
      fetchMock.mockClear();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(latest).toHaveLength(1);
    });
  });

  describe('site settings', () => {
    it('makes no engine calls on a disabled site', async () => {
      const field = setup({ hostname: 'mail.example.com', settings: { disabledSites: ['example.com'] } });

      await field.type('I will recieve it');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(latest).toEqual([]);
    });

    it('still checks on a site that is not disabled', async () => {
      const field = setup({ hostname: 'github.com', settings: { disabledSites: ['example.com'] } });

      await field.type('I will recieve it');

      expect(sentTexts()).toEqual(['I will recieve it']);
    });
  });

  describe('personal dictionary', () => {
    it('produces no spelling Error for a dictionary word', async () => {
      const field = setup({ hostname: 'github.com', settings: { dictionary: ['Recieve'] } });

      await field.type('I will recieve it');

      expect(latest).toEqual([]);
    });

    it('shows the Error again once the word is removed from the dictionary', async () => {
      const settings: Partial<Settings> = { dictionary: ['recieve'] };
      const field = setup({ hostname: 'github.com', settings });
      await field.type('I will recieve it');
      expect(latest).toEqual([]);

      settings.dictionary = [];

      expect(field.errors().map((e) => e.kind)).toEqual(['spelling']);
    });
  });

  describe('ignore once', () => {
    it('keeps an ignored Error hidden when unchanged text is re-checked', async () => {
      const field = setup();
      await field.type('I will recieve it');
      const [error] = latest;

      expect(field.ignore(error!.id)).toEqual([]);
      await field.type('I will recieve it. Thanks');

      expect(sentTexts()).toEqual(['I will recieve it', 'I will recieve it. Thanks']);
      expect(latest).toEqual([]);
    });

    it('still shows other Errors in the field', async () => {
      const field = setup();
      await field.type('I will recieve a apple');

      field.ignore(latest.find((e) => e.kind === 'spelling')!.id);

      expect(latest.map((e) => e.kind)).toEqual(['grammar']);
    });
  });

  describe.each(PROVIDERS)('LLM check ($id)', (provider) => {
    beforeEach(() => {
      llmProvider = provider.id;
    });

    it('does not send an incomplete sentence', async () => {
      const field = setup(undefined, true);

      await field.typeAndWait('I am agree with you');

      expect(llmSent()).toEqual([]);
    });

    it('sends a complete, changed sentence once', async () => {
      const field = setup(undefined, true);

      await field.typeAndWait('I am agree with you.');

      expect(llmSent()).toEqual(['I am agree with you.']);
    });

    it('serves an unchanged sentence from the cache', async () => {
      const field = setup(undefined, true);
      await field.typeAndWait('I am agree with you.');

      await field.typeAndWait('Hello. I am agree with you.');
      await field.typeAndWait('I am agree with you.');

      expect(llmSent()).toEqual(['I am agree with you.', 'Hello.']);
    });

    it('merges overlapping LanguageTool and LLM Errors into one, with the LLM explanation', async () => {
      const field = setup(undefined, true);
      const sentence = 'She ate a apple.';
      const explanation = 'Use "an" before a word that starts with a vowel sound.';
      llmReplies[sentence] = llmReply([
        { quote: 'a apple', kind: 'grammar', type: 'Article', explanation, correction: 'an apple' },
      ]);

      await field.typeAndWait(sentence);

      expect(latest).toHaveLength(1);
      expect(latest[0]).toMatchObject({ start: 8, end: 15, explanation, source: 'llm' });
    });

    it('keeps a LanguageTool Error that no LLM Error overlaps', async () => {
      const field = setup(undefined, true);
      const sentence = 'I will recieve a apple.';
      llmReplies[sentence] = llmReply([
        { quote: 'a apple', kind: 'grammar', type: 'Article', explanation: 'Use "an".', correction: 'an apple' },
      ]);

      await field.typeAndWait(sentence);

      expect(latest.map((e) => e.source)).toEqual(['languagetool', 'llm']);
    });

    it('sends the sentence to the provider with the key as a bearer token and the primary model', async () => {
      const field = setup(undefined, true);

      await field.typeAndWait('I am agree with you.');

      const [url, init] = llmCalls()[0]!;
      expect(url).toBe(provider.url);
      expect(init.headers.Authorization).toBe('Bearer test-key');
      expect(models()).toEqual([provider.models[0]]);
    });

    it.runIf(provider.id === 'gemini')('does not send the Z.ai-only thinking field', async () => {
      const field = setup(undefined, true);

      await field.typeAndWait('I am agree with you.');

      const [, init] = llmCalls()[0]!;
      expect(JSON.parse(init.body)).not.toHaveProperty('thinking');
    });

    it('accepts a reply wrapped in a markdown code fence', async () => {
      const field = setup(undefined, true);
      const sentence = 'I am agree with you.';
      const agree = { quote: 'am agree', kind: 'grammar', type: 'Verb form', explanation: 'No "am".', correction: 'agree' };
      llmReplies[sentence] = '```json\n' + llmReply([agree]) + '\n```';

      await field.typeAndWait(sentence);

      expect(latest.map((e) => [e.start, e.end, e.source])).toEqual([[2, 10, 'llm']]);
    });

    it('drops malformed entries but keeps the well-formed ones', async () => {
      const field = setup(undefined, true);
      const sentence = 'I am agree with you.';
      llmReplies[sentence] = JSON.stringify({
        errors: [
          { quote: 'am agree', kind: 'opinion', type: 'X', explanation: 'X', correction: 'agree' },
          { quote: '', kind: 'grammar', type: 'X', explanation: 'X', correction: 'X' },
          { quote: 'you', kind: 'grammar' },
          'am agree',
          { quote: 'am agree', kind: 'grammar', type: 'Verb form', explanation: 'No "am".', correction: 'agree' },
        ],
      });

      await field.typeAndWait(sentence);

      expect(latest.map((e) => [e.start, e.type])).toEqual([[2, 'Verb form']]);
    });

    it('shows no Errors for a sentence with no mistakes', async () => {
      const field = setup(undefined, true);
      llmReplies['I agree with you.'] = llmReply([]);

      await field.typeAndWait('I agree with you.');

      expect(llmSent()).toEqual(['I agree with you.']);
      expect(latest).toEqual([]);
    });

    describe('when the model is overloaded', () => {
      it('asks the fallback model instead and shows its Errors', async () => {
        const field = setup(undefined, true);
        const sentence = 'I am agree with you.';
        llmReplies[sentence] = llmReply([
          { quote: 'am agree', kind: 'grammar', type: 'Verb form', explanation: 'No "am".', correction: 'agree' },
        ]);
        llmResponses.push(provider.overloaded);

        await field.typeAndWait(sentence);

        expect(models()).toEqual(provider.models);
        expect(latest.map((e) => e.source)).toEqual(['llm']);
      });

      it('gives up quietly when the fallback model is overloaded too', async () => {
        const field = setup(undefined, true);
        llmResponses.push(provider.overloaded, provider.overloaded);

        await field.typeAndWait('I am agree with you.');

        expect(models()).toEqual(provider.models);
        expect(latest).toEqual([]);
        // An overloaded provider is not the user's quota running out.
        expect(health).toEqual({ state: 'failing', reason: 'bad-response' });
      });
    });

    describe('when the key is rate-limited', () => {
      it('does not fall back to the second model', async () => {
        const field = setup(undefined, true);
        llmResponses.push(provider.rateLimited);

        await field.typeAndWait('I am agree with you.');

        expect(models()).toEqual([provider.models[0]]);
      });

      it('backs off, then retries the sentence and shows the result', async () => {
        const field = setup(undefined, true);
        const sentence = 'I am agree with you.';
        llmReplies[sentence] = llmReply([
          { quote: 'am agree', kind: 'grammar', type: 'Verb form', explanation: 'No "am".', correction: 'agree' },
        ]);
        llmResponses.push(provider.rateLimited);
        await field.typeAndWait(sentence);
        expect(latest).toEqual([]);

        await vi.advanceTimersByTimeAsync(5_000);
        expect(llmSent()).toEqual([sentence]);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(llmSent()).toEqual([sentence, sentence]);
        expect(latest.map((e) => e.source)).toEqual(['llm']);
      });
    });

    describe('LLM health', () => {
      const allowed = { llmConsent: true, llmApiKey: 'test-key' };
      const agreeReply = llmReply([
        { quote: 'am agree', kind: 'grammar', type: 'Verb form', explanation: 'No "am".', correction: 'agree' },
      ]);

      it('is active when the LLM is allowed', () => {
        const field = setup({ hostname: 'github.com', settings: allowed }, true);

        expect(field.llmHealth()).toEqual({ state: 'active' });
      });

      it('is LT only without consent', () => {
        const field = setup({ hostname: 'github.com', settings: { ...allowed, llmConsent: false } }, true);

        expect(field.llmHealth()).toEqual({ state: 'lt-only', reason: 'no-consent' });
      });

      it('is LT only on an excluded site', () => {
        const field = setup(
          { hostname: 'mail.example.com', settings: { ...allowed, excludedSites: ['example.com'] } },
          true,
        );

        expect(field.llmHealth()).toEqual({ state: 'lt-only', reason: 'excluded-site' });
      });

      it('is failing with no key when consent is given but no key is set', () => {
        const field = setup({ hostname: 'github.com', settings: { ...allowed, llmApiKey: '' } }, true);

        expect(field.llmHealth()).toEqual({ state: 'failing', reason: 'no-key' });
      });

      it.each([
        ['no-key', 'the key is rejected (401)', () => new Response('{}', { status: 401 })],
        ['no-key', 'the key is forbidden (403)', () => new Response('{}', { status: 403 })],
        ['quota', 'the key is rate-limited (429)', provider.rateLimited],
        ['bad-response', 'the server errors (500)', () => new Response('oops', { status: 500 })],
        ['bad-response', 'the body is not a chat completion', () => new Response('<html>', { status: 200 })],
        [
          'network',
          'the request cannot reach the server',
          () => {
            throw new TypeError('Failed to fetch');
          },
        ],
      ] as const)('reports %s when %s', async (reason, _, response) => {
        const field = setup({ hostname: 'github.com', settings: allowed }, true);
        llmResponses.push(response);

        await field.typeAndWait('I am agree with you.');

        expect(health).toEqual({ state: 'failing', reason });
        expect(field.llmHealth()).toEqual({ state: 'failing', reason });
      });

      it('reports timeout when the LLM takes longer than 8s', async () => {
        const field = setup({ hostname: 'github.com', settings: allowed }, true);
        llmResponses.push(
          ({ signal }) =>
            new Promise((_, reject) =>
              signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
            ),
        );

        await field.typeAndWait('I am agree with you.');
        await vi.advanceTimersByTimeAsync(7_900);
        expect(health).toBeUndefined();

        await vi.advanceTimersByTimeAsync(200);
        expect(health).toEqual({ state: 'failing', reason: 'timeout' });
      });

      it('makes no LLM call for 60s after a failure, then retries and becomes active again', async () => {
        const field = setup({ hostname: 'github.com', settings: allowed }, true);
        const sentence = 'I am agree with you.';
        llmReplies[sentence] = agreeReply;
        llmResponses.push(() => new Response('oops', { status: 500 }));
        await field.typeAndWait(sentence);
        expect(llmSent()).toEqual([sentence]);

        await field.typeAndWait(`${sentence} Bye.`);
        await vi.advanceTimersByTimeAsync(55_000);
        expect(llmSent()).toEqual([sentence]);
        expect(health).toEqual({ state: 'failing', reason: 'bad-response' });

        await vi.advanceTimersByTimeAsync(5_000);
        expect(llmSent()).toEqual([sentence, sentence, 'Bye.']);
        expect(health).toEqual({ state: 'active' });
        expect(latest.map((e) => e.source)).toEqual(['llm']);
      });

      it('still returns LanguageTool Errors while the LLM is failing', async () => {
        const field = setup({ hostname: 'github.com', settings: allowed }, true);
        llmResponses.push(() => new Response('oops', { status: 500 }));
        await field.typeAndWait('I am agree with you.');
        expect(health?.state).toBe('failing');

        await field.typeAndWait('I am agree with you. I will recieve it.');

        expect(latest.map((e) => e.source)).toEqual(['languagetool']);
        expect(health?.state).toBe('failing');
      });

      it('forgets a failure, and retries at once, after the key changes', async () => {
        const settings: Partial<Settings> = { ...allowed };
        const field = setup({ hostname: 'github.com', settings }, true);
        llmResponses.push(() => new Response('{}', { status: 401 }));
        await field.typeAndWait('I am agree with you.');
        expect(field.llmHealth()).toEqual({ state: 'failing', reason: 'no-key' });

        settings.llmApiKey = 'new-key';
        expect(field.llmHealth()).toEqual({ state: 'active' });
        await field.typeAndWait('I am agree with you. Bye.');

        expect(llmSent()).toEqual(['I am agree with you.', 'I am agree with you.', 'Bye.']);
      });
    });

    describe('privacy settings', () => {
      const allowed = { llmConsent: true, llmApiKey: 'test-key' };

      it('sends to the LLM once the user has consented and set a key', async () => {
        const field = setup({ hostname: 'github.com', settings: allowed }, true);

        await field.typeAndWait('I am agree with you.');

        expect(llmSent()).toEqual(['I am agree with you.']);
      });

      it('makes no LLM call without consent, but still runs LanguageTool', async () => {
        const field = setup({ hostname: 'github.com', settings: { ...allowed, llmConsent: false } }, true);

        await field.typeAndWait('I will recieve it.');

        expect(llmSent()).toEqual([]);
        expect(sentTexts()).toEqual(['I will recieve it.']);
      });

      it('makes no LLM call without an API key', async () => {
        const field = setup({ hostname: 'github.com', settings: { ...allowed, llmApiKey: '' } }, true);

        await field.typeAndWait('I am agree with you.');

        expect(llmSent()).toEqual([]);
      });

      it('makes no LLM call on an excluded site, but still runs LanguageTool', async () => {
        const field = setup(
          { hostname: 'mail.example.com', settings: { ...allowed, excludedSites: ['example.com'] } },
          true,
        );

        await field.typeAndWait('I will recieve it.');

        expect(llmSent()).toEqual([]);
        expect(sentTexts()).toEqual(['I will recieve it.']);
      });

      it('clears LLM Errors once the LLM is no longer allowed', async () => {
        const settings: Partial<Settings> = { ...allowed };
        const field = setup({ hostname: 'github.com', settings }, true);
        llmReplies['I am agree with you.'] = llmReply([
          { quote: 'am agree', kind: 'grammar', type: 'Verb form', explanation: 'No "am".', correction: 'agree' },
        ]);
        await field.typeAndWait('I am agree with you.');
        expect(latest).toHaveLength(1);

        settings.llmConsent = false;
        await field.typeAndWait('I am agree with you. Bye.');

        expect(latest).toEqual([]);
      });

      it('asks the new provider, rather than reusing the old one\'s answers, after a provider switch', async () => {
        const settings: Partial<Settings> = { ...allowed };
        const field = setup({ hostname: 'github.com', settings }, true);
        await field.typeAndWait('I am agree with you.');

        settings.llmProvider = provider.id === 'glm' ? 'gemini' : 'glm';
        await field.typeAndWait('I am agree with you. Bye.');

        expect(llmSent()).toEqual(['I am agree with you.', 'I am agree with you.', 'Bye.']);
      });

      it('makes no LLM call on a disabled site', async () => {
        const field = setup(
          { hostname: 'example.com', settings: { ...allowed, disabledSites: ['example.com'] } },
          true,
        );

        await field.typeAndWait('I am agree with you.');

        expect(llmSent()).toEqual([]);
      });
    });

    describe('span matching', () => {
      const agree = {
        kind: 'grammar',
        type: 'Verb form',
        explanation: '"Agree" is a verb, so it does not need "am".',
        correction: 'agree',
      };

      it('places an Error at its exactly quoted text', async () => {
        const field = setup(undefined, true);
        const sentence = 'I am agree with you.';
        llmReplies[sentence] = llmReply([{ quote: 'am agree', ...agree }]);

        await field.typeAndWait(sentence);

        expect(latest).toEqual([
          {
            id: expect.any(String),
            start: 2,
            end: 10,
            kind: 'grammar',
            type: 'Verb form',
            explanation: agree.explanation,
            suggestions: ['agree'],
            source: 'llm',
          },
        ]);
      });

      it('offsets an Error in a later sentence into whole-field coordinates', async () => {
        const field = setup(undefined, true);
        llmReplies['I am agree with you.'] = llmReply([{ quote: 'am agree', ...agree }]);

        await field.typeAndWait('Hi there. I am agree with you.');

        expect(latest.map((e) => [e.start, e.end])).toEqual([[12, 20]]);
      });

      it('matches a quoted word as a whole word, not inside another word', async () => {
        const field = setup(undefined, true);
        const sentence = 'This is the best.';
        llmReplies[sentence] = llmReply([{ ...agree, quote: 'is', correction: 'was' }]);

        await field.typeAndWait(sentence);

        expect(latest.map((e) => e.start)).toEqual([5]);
      });

      it('places repeated quotes at successive occurrences of a repeated word', async () => {
        const field = setup(undefined, true);
        const sentence = 'He go home and she go out.';
        const go = { ...agree, quote: 'go', correction: 'goes' };
        llmReplies[sentence] = llmReply([go, go]);

        await field.typeAndWait(sentence);

        expect(latest.map((e) => e.start)).toEqual([3, 19]);
      });

      it('drops an Error whose quote is not in the sentence', async () => {
        const field = setup(undefined, true);
        const sentence = 'I am agree with you.';
        llmReplies[sentence] = llmReply([{ quote: 'am agreeing', ...agree }]);

        await field.typeAndWait(sentence);

        expect(latest).toEqual([]);
      });

      it('produces no Errors, and does not crash, when the reply is not valid JSON', async () => {
        const field = setup(undefined, true);
        const sentence = 'I am agree with you.';
        llmReplies[sentence] = 'Sure! Here are the errors: [am agree]';

        await field.typeAndWait(sentence);

        expect(latest).toEqual([]);
        await field.typeAndWait(`${sentence} Thanks.`);
        expect(llmSent()).toEqual([sentence, 'Thanks.']);
      });
    });
  });
});
