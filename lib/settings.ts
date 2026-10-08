import type { LanguageToolConfig } from './engines/language-tool';
import { DEFAULT_LLM_PROVIDER, isLlmProviderId, type LlmProviderId } from './llm-providers';

export type EnglishVariant = 'en-US' | 'en-GB';

export interface Settings {
  /** Which LLM provider receives finished sentences. */
  llmProvider: LlmProviderId;
  /** API key for the LLM engine's provider; empty until the user enters one. */
  llmApiKey: string;
  /** Whether the user accepted, on the Consent page, that text is sent to `llmProvider`. */
  llmConsent: boolean;
  englishVariant: EnglishVariant;
  languageToolUrl: string;
  /** Sites whose text is never sent to the LLM (LanguageTool still runs). */
  excludedSites: string[];
  /** Sites where the extension is completely off: no checking, no overlay. */
  disabledSites: string[];
  /** The user's own words, never flagged as spelling Errors. */
  dictionary: string[];
}

export const DEFAULT_LANGUAGE_TOOL_URL = 'https://api.languagetool.org';

export const DEFAULT_SETTINGS: Settings = {
  llmProvider: DEFAULT_LLM_PROVIDER,
  llmApiKey: '',
  llmConsent: false,
  englishVariant: 'en-US',
  languageToolUrl: DEFAULT_LANGUAGE_TOOL_URL,
  excludedSites: [],
  disabledSites: [],
  dictionary: [],
};

/** Fills in defaults for anything missing or malformed in stored settings. */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const value = raw ?? {};
  return {
    llmProvider: isLlmProviderId(value.llmProvider) ? value.llmProvider : DEFAULT_SETTINGS.llmProvider,
    llmApiKey: typeof value.llmApiKey === 'string' ? value.llmApiKey.trim() : DEFAULT_SETTINGS.llmApiKey,
    llmConsent: value.llmConsent === true,
    englishVariant: value.englishVariant === 'en-GB' || value.englishVariant === 'en-US' ? value.englishVariant : DEFAULT_SETTINGS.englishVariant,
    languageToolUrl: normalizeUrl(value.languageToolUrl) ?? DEFAULT_LANGUAGE_TOOL_URL,
    excludedSites: normalizeSites(value.excludedSites),
    disabledSites: normalizeSites(value.disabledSites),
    dictionary: normalizeDictionary(value.dictionary),
  };
}

/**
 * `current` with `changes` applied. Changing the LLM provider revokes consent
 * (the user must accept the new recipient on the Consent page) and drops the
 * old key, so neither text nor a key reaches a provider it wasn't meant for.
 */
export function mergeSettings(current: Settings, changes: Partial<Settings>): Settings {
  const next = normalizeSettings({ ...current, ...changes });
  if (next.llmProvider === current.llmProvider) return next;
  return {
    ...next,
    llmConsent: false,
    llmApiKey: next.llmApiKey === current.llmApiKey ? '' : next.llmApiKey,
  };
}

export function languageToolConfig(settings: Settings): LanguageToolConfig {
  return { apiUrl: settings.languageToolUrl, language: settings.englishVariant };
}

/**
 * Whether `hostname` is covered by a site list. An entry covers its own host
 * and every subdomain of it, so `example.com` also covers `mail.example.com`.
 */
export function isSiteListed(hostname: string, sites: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return sites.some((site) => host === site || host.endsWith(`.${site}`));
}

export function isSiteDisabled(hostname: string, settings: Settings): boolean {
  return isSiteListed(hostname, settings.disabledSites);
}

export function isSiteExcluded(hostname: string, settings: Settings): boolean {
  return isSiteListed(hostname, settings.excludedSites);
}

/**
 * Reduces whatever the user typed (`https://www.Example.com/path`, `example.com:8080`)
 * to a bare lowercase hostname, or `undefined` if nothing usable is left.
 */
export function normalizeSite(input: string): string | undefined {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split(/[/?#]/, 1)[0] ?? '';
  host = host.replace(/:\d*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  return host && /^[a-z0-9.-]+$/.test(host) ? host : undefined;
}

/** Trimmed, non-empty words, each kept once regardless of case. */
function normalizeDictionary(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const words = new Map<string, string>();
  for (const entry of value) {
    const word = typeof entry === 'string' ? entry.trim() : '';
    if (word && !words.has(word.toLowerCase())) words.set(word.toLowerCase(), word);
  }
  return [...words.values()];
}

/** Whether `word` is in the dictionary, ignoring case. */
export function isInDictionary(word: string, settings: Settings): boolean {
  const lower = word.trim().toLowerCase();
  return settings.dictionary.some((entry) => entry.toLowerCase() === lower);
}

function normalizeSites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const sites = value.flatMap((entry) => (typeof entry === 'string' ? (normalizeSite(entry) ?? []) : []));
  return [...new Set(sites)];
}

/**
 * An http(s) URL without its trailing slash or a trailing `/v2` / `/v2/check`
 * (the engine appends `/v2/check` itself), or `undefined` if it isn't one.
 */
export function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href.replace(/\/+$/, '').replace(/\/v2(\/check)?$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Whether text typed on `hostname` may be sent to the LLM: only with consent,
 * a key to send it with, and never on an excluded or disabled site.
 */
export function isLlmAllowed(hostname: string, settings: Settings): boolean {
  return (
    settings.llmConsent &&
    settings.llmApiKey !== '' &&
    !isSiteExcluded(hostname, settings) &&
    !isSiteDisabled(hostname, settings)
  );
}
