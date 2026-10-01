import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLanguageToolEngine } from './engines/language-tool';
import {
  DEFAULT_SETTINGS,
  isSiteDisabled,
  isSiteExcluded,
  languageToolConfig,
  normalizeSettings,
  normalizeSite,
} from './settings';

describe('LanguageTool requests follow Settings', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ matches: [] }), { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  async function checkWith(settings: Partial<typeof DEFAULT_SETTINGS>) {
    const engine = createLanguageToolEngine(languageToolConfig(normalizeSettings(settings)));
    await engine.check('The colour is nice.');
    const [url, init] = fetchMock.mock.calls[0]!;
    return { url, language: new URLSearchParams(init.body).get('language') };
  }

  it('sends en-US to the public API by default', async () => {
    expect(await checkWith({})).toEqual({
      url: 'https://api.languagetool.org/v2/check',
      language: 'en-US',
    });
  });

  it('sends en-GB when British English is chosen', async () => {
    expect((await checkWith({ englishVariant: 'en-GB' })).language).toBe('en-GB');
  });

  it('sends requests to a configured LanguageTool URL', async () => {
    expect((await checkWith({ languageToolUrl: 'http://localhost:8081/' })).url).toBe(
      'http://localhost:8081/v2/check',
    );
  });

  it('falls back to the public API when the stored URL is not http(s)', async () => {
    expect((await checkWith({ languageToolUrl: 'not a url' })).url).toBe(
      'https://api.languagetool.org/v2/check',
    );
  });
});

describe('site lists', () => {
  it('covers the listed host and its subdomains, but not lookalikes', () => {
    const settings = normalizeSettings({ disabledSites: ['example.com'] });

    expect(isSiteDisabled('example.com', settings)).toBe(true);
    expect(isSiteDisabled('mail.example.com', settings)).toBe(true);
    expect(isSiteDisabled('notexample.com', settings)).toBe(false);
    expect(isSiteDisabled('example.com.evil.net', settings)).toBe(false);
  });

  it('keeps excluded and disabled sites separate', () => {
    const settings = normalizeSettings({ excludedSites: ['work.internal'] });

    expect(isSiteExcluded('jira.work.internal', settings)).toBe(true);
    expect(isSiteDisabled('jira.work.internal', settings)).toBe(false);
  });

  it('reduces typed entries to bare hostnames', () => {
    expect(normalizeSite('https://www.GitHub.com/asstronut?tab=1')).toBe('github.com');
    expect(normalizeSite('  localhost:5173 ')).toBe('localhost');
    expect(normalizeSite('   ')).toBeUndefined();
    expect(normalizeSite('not a site!')).toBeUndefined();
  });

  it('drops malformed and duplicate stored entries', () => {
    const settings = normalizeSettings({ excludedSites: ['GitHub.com', 'github.com', 42 as never, ''] });

    expect(settings.excludedSites).toEqual(['github.com']);
  });
});
