import type { LlmFailure } from './engine';
import { llmPermission, type LlmPermission, type Settings } from './settings';

/**
 * Whether text typed on the page goes to the LLM: `active` when it does,
 * `lt-only` when the user chose not to, `failing` when it should but can't
 * right now.
 */
export type LlmHealth =
  | { state: 'active' }
  | { state: 'lt-only'; reason: 'no-consent' | 'excluded-site' }
  | { state: 'failing'; reason: LlmFailure };

/** The page's way to the background worker, whose LLM gate is the only place that knows why the LLM fails. */
export interface LlmFailureLink {
  /** Why the LLM fails right now, or undefined if it doesn't. */
  currentFailure(): Promise<LlmFailure | undefined>;
  /**
   * Calls `onChange` with the failure the worker announces whenever it
   * changes, or undefined after a success; returns a function that stops it.
   */
  onFailureChange(onChange: (failure: LlmFailure | undefined) => void): () => void;
}

/** Where the page reads its Settings and hears about changes to them. */
export interface SettingsSource {
  get(): Settings;
  /** Calls `onChange` with the new Settings after every change; returns a function that stops it. */
  watch(onChange: (settings: Settings) => void): () => void;
}

export interface LlmHealthOptions {
  /** The page's hostname. */
  hostname: string;
  settings: SettingsSource;
  link: LlmFailureLink;
}

/** The LLM health every Field on one page shares. */
export interface PageLlmHealth {
  /** The LLM health now. */
  health(): LlmHealth;
  /** Whether text may go to the LLM now, or why not. A failure does not stop it: the worker's gate turns the check away. */
  mayCheck(): LlmPermission;
  /** Calls `onChange` with the new LLM health whenever it changes; returns a function that stops it. */
  watch(onChange: (health: LlmHealth) => void): () => void;
  dispose(): void;
}

export function createLlmHealth(options: LlmHealthOptions): PageLlmHealth {
  const { hostname, link } = options;
  let settings = options.settings.get();
  /** Why the worker says the LLM fails, or undefined while it doesn't. */
  let failure: LlmFailure | undefined;
  /** How many times the worker has been asked why the LLM fails. */
  let asked = 0;
  const watchers = new Set<(health: LlmHealth) => void>();
  /** The health the watchers were last told, or started with. */
  let current = health();

  function health(): LlmHealth {
    const permission = llmPermission(hostname, settings);
    if (!permission.allowed) {
      switch (permission.reason) {
        case 'no-consent':
        case 'excluded-site':
          return { state: 'lt-only', reason: permission.reason };
        case 'no-key':
          return { state: 'failing', reason: 'no-key' };
        case 'disabled-site':
          // Not the LLM's health: the page gets what it would with Type Right on.
          break;
      }
    }
    return failure ? { state: 'failing', reason: failure } : { state: 'active' };
  }

  /** Tells the watchers if the health is not the one they know. */
  function refresh(): void {
    const next = health();
    if (next.state === current.state && reasonOf(next) === reasonOf(current)) return;
    current = next;
    watchers.forEach((onChange) => onChange(next));
  }

  /** Asks the worker why the LLM fails now. */
  function ask(): void {
    const question = ++asked;
    link.currentFailure().then(
      (answer) => {
        // A later question, or an announcement since, is newer than this answer.
        if (question !== asked) return;
        failure = answer;
        refresh();
      },
      () => {},
    );
  }

  const stopListening = link.onFailureChange((next) => {
    failure = next;
    refresh();
    // After a Settings change this may be a failure made with the old key, which only the worker can tell.
    ask();
  });
  ask();

  // The Provider or key may have changed, which only the worker's gate can tell a failure from.
  const stopWatchingSettings = options.settings.watch((next) => {
    // Changing the key or Provider clears a failure; the worker's answer may bring a newer one.
    if (next.llmProvider !== settings.llmProvider || next.llmApiKey !== settings.llmApiKey) failure = undefined;
    settings = next;
    refresh();
    ask();
  });

  return {
    health: () => current,
    mayCheck: () => llmPermission(hostname, settings),
    watch(onChange) {
      watchers.add(onChange);
      return () => watchers.delete(onChange);
    },
    dispose() {
      stopListening();
      stopWatchingSettings();
      watchers.clear();
    },
  };
}

function reasonOf(health: LlmHealth): string | undefined {
  return health.state === 'active' ? undefined : health.reason;
}
