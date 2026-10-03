import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLanguageToolEngine } from './engines/language-tool';
import {
  DEFAULT_SETTINGS,
  isLlmAllowed,
  isSiteDisabled,
  isSiteExcluded,
  languageToolConfig,
  mergeSettings,
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

  it.each([
    'http://localhost:8081/v2',
    'http://localhost:8081/v2/',
    'http://localhost:8081/v2/check',
    'http://localhost:8081/v2/check/',
  ])('does not double the API path when the URL is %s', async (languageToolUrl) => {
    expect((await checkWith({ languageToolUrl })).url).toBe('http://localhost:8081/v2/check');
  });

  it('keeps a path prefix before /v2', async () => {
    expect((await checkWith({ languageToolUrl: 'https://host/lt/v2' })).url).toBe(
      'https://host/lt/v2/check',
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

describe('LLM consent', () => {
  it('is not given until stored as exactly true', () => {
    expect(normalizeSettings(undefined).llmConsent).toBe(false);
    expect(normalizeSettings({ llmConsent: 'yes' as unknown as boolean }).llmConsent).toBe(false);
    expect(normalizeSettings({ llmConsent: true }).llmConsent).toBe(true);
  });
});

describe('LLM provider', () => {
  const glmUser = normalizeSettings({ llmProvider: 'glm', llmApiKey: 'glm-key', llmConsent: true });

  it('defaults to GLM when missing or unrecognised, so older Settings keep working', () => {
    expect(normalizeSettings(undefined).llmProvider).toBe('glm');
    expect(normalizeSettings({ llmApiKey: 'k', llmConsent: true }).llmProvider).toBe('glm');
    expect(normalizeSettings({ llmProvider: 'openai' as never }).llmProvider).toBe('glm');
  });

  it('keeps a valid provider', () => {
    expect(normalizeSettings({ llmProvider: 'gemini' }).llmProvider).toBe('gemini');
    expect(normalizeSettings({ llmProvider: 'glm' }).llmProvider).toBe('glm');
  });

  it('gates the LLM the same way for either provider', () => {
    for (const llmProvider of ['glm', 'gemini'] as const) {
      const allowed = normalizeSettings({ llmProvider, llmApiKey: 'k', llmConsent: true, excludedSites: ['x.com'] });
      expect(isLlmAllowed('github.com', allowed)).toBe(true);
      expect(isLlmAllowed('x.com', allowed)).toBe(false);
      expect(isLlmAllowed('github.com', { ...allowed, llmConsent: false })).toBe(false);
      expect(isLlmAllowed('github.com', { ...allowed, llmApiKey: '' })).toBe(false);
    }
  });

  it('revokes consent and clears the key when the provider changes', () => {
    const next = mergeSettings(glmUser, { llmProvider: 'gemini' });

    expect(next).toMatchObject({ llmProvider: 'gemini', llmConsent: false, llmApiKey: '' });
    expect(isLlmAllowed('github.com', next)).toBe(false);
  });

  it('never carries the old key over, even when it is resubmitted with the change', () => {
    const next = mergeSettings(glmUser, { llmProvider: 'gemini', llmApiKey: 'glm-key', llmConsent: true });

    expect(next).toMatchObject({ llmApiKey: '', llmConsent: false });
  });

  it('keeps a new key entered together with the provider change, but still needs fresh consent', () => {
    const next = mergeSettings(glmUser, { llmProvider: 'gemini', llmApiKey: 'gemini-key', llmConsent: true });

    expect(next).toMatchObject({ llmProvider: 'gemini', llmApiKey: 'gemini-key', llmConsent: false });
  });

  it('leaves key and consent alone when the provider is unchanged', () => {
    expect(mergeSettings(glmUser, { llmProvider: 'glm', englishVariant: 'en-GB' })).toMatchObject({
      llmApiKey: 'glm-key',
      llmConsent: true,
    });
    expect(mergeSettings(glmUser, { excludedSites: ['a.com'] })).toMatchObject({ llmApiKey: 'glm-key', llmConsent: true });
  });
});
