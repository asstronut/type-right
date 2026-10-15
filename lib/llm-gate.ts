import { LLM_FAILURE_PAUSE_MS, LlmFailedError, type Engine, type LlmFailure } from './engine';
import type { Settings } from './settings';
import type { Slip } from './slips';

/** Why the LLM last failed, the Provider and key (see `llmCredentials`) it failed with, and the end of the pause after it. */
export interface LlmPause {
  reason: LlmFailure;
  credentials: string;
  pausedUntil: number;
}

export interface LlmGateOptions {
  /** The LLM engine for the given Settings' Provider and key. */
  engine(settings: Settings): Engine;
  /** The Settings now, to tell whether a check failed with credentials the user has since changed. */
  settings(): Promise<Settings>;
  /**
   * Called with the new failure's reason, or undefined after a success,
   * whenever it changes. Only failures made with the current Provider and key
   * are announced, so whoever listens never needs to compare them.
   */
  onFailureChange?(failure: LlmFailure | undefined): void;
  /** Keeps the failure and its pause across worker restarts; without it they live in memory only. */
  storage?: {
    get(): Promise<LlmPause | undefined | null>;
    set(pause: LlmPause | undefined): Promise<void>;
  };
}

/**
 * The single way to the LLM, shared by every Field in every tab. A failure's
 * causes (a bad key, used-up quota, no network) are not one Field's, so after
 * one every check is refused for a while without asking the Provider.
 */
export interface LlmGate {
  /**
   * Checks one sentence with the Settings' Provider. Throws an LlmFailedError
   * when the check fails, and the same one at once while paused after it,
   * with how much of the pause is left. A check that fails after the user
   * changed the Provider or key starts no pause and is not announced: the
   * error says to ask again at once, with the new ones.
   */
  check(text: string, settings: Settings): Promise<Slip[]>;
  /**
   * The last check's failure, or undefined if it succeeded or happened with
   * another Provider or key than the Settings' (the user likely changed them
   * to fix it, so the next check asks the Provider at once).
   */
  failure(settings: Settings): Promise<LlmFailure | undefined>;
}

/** Identifies the Provider and key an LLM request is sent with, so a failure can be tied to them. Only the gate knows them. */
function llmCredentials(settings: Settings): string {
  return `${settings.llmProvider}:${settings.llmApiKey}`;
}

export function createLlmGate(options: LlmGateOptions): LlmGate {
  let pause: LlmPause | undefined;
  let loaded: Promise<void> | undefined;

  /** Reads the pause a previous worker left, once. */
  function load(): Promise<void> {
    return (loaded ??= (options.storage?.get() ?? Promise.resolve(undefined)).then((saved) => {
      pause = saved ?? undefined;
    }));
  }

  async function check(text: string, settings: Settings): Promise<Slip[]> {
    await load();
    const credentials = llmCredentials(settings);
    if (pause && pause.credentials !== credentials) setPause(undefined);
    const waitMs = pause ? pause.pausedUntil - Date.now() : 0;
    if (pause && waitMs > 0) throw new LlmFailedError(pause.reason, waitMs);
    let found: Slip[];
    try {
      found = await options.engine(settings).check(text);
    } catch (error) {
      const reason = error instanceof LlmFailedError ? error.failure : 'bad-response';
      if (llmCredentials(await options.settings()) !== credentials) throw new LlmFailedError(reason, 0);
      setPause({ reason, credentials, pausedUntil: Date.now() + LLM_FAILURE_PAUSE_MS });
      throw new LlmFailedError(reason, LLM_FAILURE_PAUSE_MS);
    }
    setPause(undefined);
    return found;
  }

  function setPause(next: LlmPause | undefined): void {
    const changed = next?.reason !== pause?.reason || next?.credentials !== pause?.credentials;
    if (!next && !pause) return;
    pause = next;
    void options.storage?.set(next).catch(() => {});
    if (changed) options.onFailureChange?.(next?.reason);
  }

  return {
    check,
    async failure(settings) {
      await load();
      return pause?.credentials === llmCredentials(settings) ? pause.reason : undefined;
    },
  };
}
