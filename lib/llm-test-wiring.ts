import type { LlmFailure } from './engine';
import { createLlmEngine } from './engines/llm';
import { createLlmGate, type LlmGate } from './llm-gate';
import { createLlmHealth, type LlmFailureLink, type PageLlmHealth, type SettingsSource } from './llm-health';
import { DEFAULT_SETTINGS, type Settings } from './settings';

/**
 * The browser around the LLM, for tests: one background worker (the real gate,
 * talking to whatever `fetch` is stubbed to), the Settings every page shares,
 * and pages whose LLM health is the production module wired to that worker.
 */
export interface TestLlmWiring {
  /** The worker's gate. A Field's LLM engine in a test is a check through it with `settings()`. */
  gate: LlmGate;
  settings(): Settings;
  /** Saves `changes` as the Options page would, and tells every page. */
  changeSettings(changes: Partial<Settings>): void;
  settingsSource: SettingsSource;
  /** A page's link to the worker; its announcements arrive a moment after the gate makes them, as messages do. */
  link: LlmFailureLink;
  /** A page (content script) on `hostname`. */
  openPage(hostname: string): PageLlmHealth;
}

export function createTestLlmWiring(initial: Partial<Settings> = {}): TestLlmWiring {
  let settings: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const settingsWatchers = new Set<(settings: Settings) => void>();
  const failureWatchers = new Set<(failure: LlmFailure | undefined) => void>();

  const gate = createLlmGate({
    engine: (s) => createLlmEngine(s.llmProvider, s.llmApiKey),
    settings: async () => settings,
    onFailureChange: (failure) => {
      void Promise.resolve().then(() => failureWatchers.forEach((watcher) => watcher(failure)));
    },
  });

  const settingsSource: SettingsSource = {
    get: () => settings,
    watch(onChange) {
      settingsWatchers.add(onChange);
      return () => settingsWatchers.delete(onChange);
    },
  };

  const link: LlmFailureLink = {
    currentFailure: () => gate.failure(settings),
    onFailureChange(onChange) {
      failureWatchers.add(onChange);
      return () => failureWatchers.delete(onChange);
    },
  };

  return {
    gate,
    settings: () => settings,
    changeSettings(changes) {
      settings = { ...settings, ...changes };
      settingsWatchers.forEach((watcher) => watcher(settings));
    },
    settingsSource,
    link,
    openPage: (hostname) => createLlmHealth({ hostname, settings: settingsSource, link }),
  };
}
