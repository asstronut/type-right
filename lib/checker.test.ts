import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFieldChecker } from './checker';
import { createLanguageToolEngine } from './engines/language-tool';
import type { CheckError } from './errors';
import { DEFAULT_SETTINGS, type Settings } from './settings';

const DEBOUNCE_MS = 600;

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

describe('createFieldChecker', () => {
  const fetchMock = vi.fn();
  let latest: CheckError[];

  function setup(site?: { hostname: string; settings: Partial<Settings> }) {
    const languageTool = createLanguageToolEngine({
      apiUrl: 'https://api.languagetool.org',
      language: 'en-US',
    });
    const checker = createFieldChecker({
      engines: { languageTool },
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
      update: checker.update,
    };
  }

  /** The texts LanguageTool was asked to check, in order. */
  function sentTexts(): string[] {
    return fetchMock.mock.calls.map(([, init]) => new URLSearchParams(init.body).get('text')!);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    latest = [];
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (_url: string, init: { body: URLSearchParams }) => {
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
});
