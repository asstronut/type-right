import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { LlmFailedError, RateLimitedError } from '../lib/engine';
import { createLlmEngine } from '../lib/engines/llm';
import { createLanguageToolEngine } from '../lib/engines/language-tool';
import { createLlmGate, type LlmPause } from '../lib/llm-gate';
import type { Slip } from '../lib/slips';
import type {
  CheckMessage,
  CheckResponse,
  LlmFailureMessage,
  LlmFailureQuery,
  LlmFailureResponse,
  TallyMessage,
} from '../lib/messages';
import { isLlmAllowed, languageToolConfig, llmCredentials, type Settings } from '../lib/settings';
import { store } from '../lib/store';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== 'install') return;
    if ((await store.getSettings()).llmConsent) return;
    await browser.tabs.create({ url: browser.runtime.getURL('/consent.html') });
  });

  /** Tally updates run one after another, so concurrent fields, tabs and the Popup never overwrite each other's counts. */
  let tallyUpdates = Promise.resolve();
  function queueTallyUpdate(update: () => Promise<void>): Promise<void> {
    tallyUpdates = tallyUpdates.then(update).catch(() => {});
    return tallyUpdates;
  }

  /**
   * Every LLM check goes through this gate, so a failure pauses the LLM for
   * every field in every tab. The pause is kept in session storage: MV3 stops
   * an idle worker well within it, and the next worker must still announce
   * the recovery to tabs showing the failure.
   */
  const llmPause = storage.defineItem<LlmPause | null>('session:llmPause', { fallback: null });
  const llmGate = createLlmGate({
    engine: (settings) => createLlmEngine(settings.llmProvider, settings.llmApiKey),
    onFailureChange: (failure) => void broadcast({ type: 'llm-failure', failure: failure ?? null }),
    storage: { get: () => llmPause.getValue(), set: (pause) => llmPause.setValue(pause ?? null) },
  });

  browser.runtime.onMessage.addListener((message: CheckMessage | TallyMessage | LlmFailureQuery, sender) => {
    if (message?.type === 'record-slips') return queueTallyUpdate(() => store.recordSlips(message.sightings));
    if (message?.type === 'reset-tally') return queueTallyUpdate(() => store.resetTally());
    if (message?.type === 'check-field') {
      return respond((settings) => createLanguageToolEngine(languageToolConfig(settings)).check(message.text));
    }
    if (message?.type === 'check-sentence') {
      return respond((settings) => {
        // The checker gates this too; this is the last line before text leaves the browser.
        const hostname = sender.url ? new URL(sender.url).hostname : '';
        if (!hostname || !isLlmAllowed(hostname, settings)) throw new Error('LLM not allowed');
        return llmGate.check(message.text, settings);
      });
    }
    if (message?.type === 'get-llm-failure') {
      return store.getSettings().then(async (settings): Promise<LlmFailureResponse> => {
        const reason = await llmGate.failure(settings);
        return reason ? { reason, credentials: llmCredentials(settings) } : null;
      });
    }
  });
});

/** Sends `message` to every frame of every tab; tabs without Type Right ignore it. */
async function broadcast(message: LlmFailureMessage): Promise<void> {
  for (const tab of await browser.tabs.query({})) {
    if (tab.id !== undefined) browser.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

/** Settings are read per check so a change on the Options page applies to the next keystroke. */
function respond(check: (settings: Settings) => Promise<Slip[]>): Promise<CheckResponse> {
  return store
    .getSettings()
    .then(check)
    .then(
      (slips): CheckResponse => ({ ok: true, slips }),
      (error): CheckResponse => {
        if (error instanceof RateLimitedError) {
          return { ok: false, reason: 'rate-limited', retryAfterMs: error.retryAfterMs };
        }
        if (error instanceof LlmFailedError) {
          return { ok: false, reason: 'llm-failed', failure: error.failure, retryAfterMs: error.retryAfterMs };
        }
        return { ok: false, reason: 'failed' };
      },
    );
}
