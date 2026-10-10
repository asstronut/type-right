import type { LlmFailure } from './engine';

/** After any LLM failure, no request reaches the Provider for this long. */
export const LLM_FAILURE_PAUSE_MS = 60_000;

/** Why the LLM last failed, and the Provider and key (see `llmCredentials`) it failed with. */
export interface LlmFailureRecord {
  reason: LlmFailure;
  credentials: string;
}

/**
 * The LLM's last failure, shared by every Field in a tab so their LLM badges
 * change together. The background worker's broadcasts keep it in step with
 * the other tabs.
 */
export interface SharedLlmFailure {
  /** The last failure, or undefined after a success. */
  get(): LlmFailureRecord | undefined;
  set(failure: LlmFailureRecord | undefined): void;
  /** Calls `onChange` after every change; returns a function that stops it. */
  watch(onChange: () => void): () => void;
}

export function createSharedLlmFailure(): SharedLlmFailure {
  let current: LlmFailureRecord | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(failure) {
      if (failure?.reason === current?.reason && failure?.credentials === current?.credentials) return;
      current = failure;
      listeners.forEach((onChange) => onChange());
    },
    watch(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}
