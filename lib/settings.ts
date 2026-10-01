import type { LanguageToolConfig } from './engines/language-tool';

export type EnglishVariant = 'en-US' | 'en-GB';

export interface Settings {
  /** GLM (Zhipu AI) API key for the LLM engine; empty until the user enters one. */
  llmApiKey: string;
  englishVariant: EnglishVariant;
  languageToolUrl: string;
  /** Sites whose text is never sent to the LLM (LanguageTool still runs). */
  excludedSites: string[];
  /** Sites where the extension is completely off: no checking, no overlay. */
  disabledSites: string[];
}

export const DEFAULT_LANGUAGE_TOOL_URL = 'https://api.languagetool.org';

export const DEFAULT_SETTINGS: Settings = {
  llmApiKey: '',
  englishVariant: 'en-US',
  languageToolUrl: DEFAULT_LANGUAGE_TOOL_URL,
  excludedSites: [],
  disabledSites: [],
};

/** Fills in defaults for anything missing or malformed in stored settings. */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const value = raw ?? {};
  return {
    llmApiKey: typeof value.llmApiKey === 'string' ? value.llmApiKey.trim() : DEFAULT_SETTINGS.llmApiKey,
    englishVariant: value.englishVariant === 'en-GB' || value.englishVariant === 'en-US' ? value.englishVariant : DEFAULT_SETTINGS.englishVariant,
    languageToolUrl: normalizeUrl(value.languageToolUrl) ?? DEFAULT_LANGUAGE_TOOL_URL,
    excludedSites: normalizeSites(value.excludedSites),
    disabledSites: normalizeSites(value.disabledSites),
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

function normalizeSites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const sites = value.flatMap((entry) => (typeof entry === 'string' ? (normalizeSite(entry) ?? []) : []));
  return [...new Set(sites)];
}

/** An http(s) URL without its trailing slash, or `undefined` if it isn't one. */
export function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}
