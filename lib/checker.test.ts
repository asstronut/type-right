import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFieldChecker } from './checker';
import { createGlmEngine, GLM_API_URL } from './engines/glm';
import { createLanguageToolEngine } from './engines/language-tool';
import type { CheckError } from './errors';
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

/** Canned GLM replies, by the exact sentence sent; any other sentence gets no errors. */
let llmReplies: Record<string, string>;
/** Raw GLM responses to return, in order, before falling back to `llmReplies`. */
let glmResponses: (() => Response)[];

function llmReply(errors: LlmMistake[]): string {
  return JSON.stringify({ errors });
}

function chatCompletion(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
    { status: 200 },
  );
}

/** The sentence a GLM request asks about: the last user message. */
function llmSentence(init: { body: string }): string {
  const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
  return body.messages.filter((m) => m.role === 'user').at(-1)!.content;
}

describe('createFieldChecker', () => {
  const fetchMock = vi.fn();
  let latest: CheckError[];

  function setup(site?: { hostname: string; settings: Partial<Settings> }, withLlm = false) {
    const languageTool = createLanguageToolEngine({
      apiUrl: 'https://api.languagetool.org',
      language: 'en-US',
    });
    const llm = withLlm ? createGlmEngine({ apiKey: 'test-key' }) : undefined;
    const checker = createFieldChecker({
      engines: { languageTool, llm },
      site: site && {
        hostname: site.hostname,
        settings: () => ({ ...DEFAULT_SETTINGS, ...site.settings }),
      },
      onChange: (errors) => {
        latest = errors;
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
    };
  }

  /** The texts LanguageTool was asked to check, in order. */
  function sentTexts(): string[] {
    return fetchMock.mock.calls
      .filter(([url]) => url !== GLM_API_URL)
      .map(([, init]) => new URLSearchParams(init.body).get('text')!);
  }

  /** The sentences GLM was asked to check, in order. */
  function llmSent(): string[] {
    return fetchMock.mock.calls.filter(([url]) => url === GLM_API_URL).map(([, init]) => llmSentence(init));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    latest = [];
    llmReplies = {};
    glmResponses = [];
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string, init: { body: string }) => {
      if (url === GLM_API_URL) {
        const queued = glmResponses.shift();
        if (queued) return queued();
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

  describe('LLM check', () => {
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

    describe('when GLM is overloaded', () => {
      /** Z.ai's reply when a model is overloaded: HTTP 429 with business code 1305. */
      function overloaded(): Response {
        return new Response(
          JSON.stringify({ error: { code: '1305', message: 'The service may be temporarily overloaded' } }),
          { status: 429 },
        );
      }

      function models(): string[] {
        return fetchMock.mock.calls
          .filter(([url]) => url === GLM_API_URL)
          .map(([, init]) => (JSON.parse(init.body) as { model: string }).model);
      }

      it('asks the fallback model instead and shows its Errors', async () => {
        const field = setup(undefined, true);
        const sentence = 'I am agree with you.';
        llmReplies[sentence] = llmReply([
          { quote: 'am agree', kind: 'grammar', type: 'Verb form', explanation: 'No "am".', correction: 'agree' },
        ]);
        glmResponses.push(overloaded);

        await field.typeAndWait(sentence);

        expect(models()).toEqual(['glm-4.7-flash', 'glm-4.5-flash']);
        expect(latest.map((e) => e.source)).toEqual(['llm']);
      });

      it('does not fall back on an ordinary rate limit', async () => {
        const field = setup(undefined, true);
        glmResponses.push(
          () => new Response(JSON.stringify({ error: { code: '1302', message: 'Rate limit reached' } }), { status: 429 }),
        );

        await field.typeAndWait('I am agree with you.');

        expect(models()).toEqual(['glm-4.7-flash']);
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
