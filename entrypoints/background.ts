import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { LlmFailedError, RateLimitedError } from '../lib/engine';
import { createLlmEngine } from '../lib/engines/llm';
import { createLanguageToolEngine } from '../lib/engines/language-tool';
import type { CheckError } from '../lib/errors';
import type { CheckMessage, CheckResponse, TallyMessage } from '../lib/messages';
import { isLlmAllowed, languageToolConfig, type Settings } from '../lib/settings';
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

  browser.runtime.onMessage.addListener((message: CheckMessage | TallyMessage, sender) => {
    if (message?.type === 'record-errors') return queueTallyUpdate(() => store.recordErrors(message.sightings));
    if (message?.type === 'reset-tally') return queueTallyUpdate(() => store.resetTally());
    if (message?.type === 'check-field') {
      return respond((settings) => createLanguageToolEngine(languageToolConfig(settings)).check(message.text));
    }
    if (message?.type === 'check-sentence') {
      return respond((settings) => {
        // The checker gates this too; this is the last line before text leaves the browser.
        const hostname = sender.url ? new URL(sender.url).hostname : '';
        if (!hostname || !isLlmAllowed(hostname, settings)) throw new Error('LLM not allowed');
        return createLlmEngine(settings.llmProvider, settings.llmApiKey).check(message.text);
      });
    }
  });
});

/** Settings are read per check so a change on the Options page applies to the next keystroke. */
function respond(check: (settings: Settings) => Promise<CheckError[]>): Promise<CheckResponse> {
  return store
    .getSettings()
    .then(check)
    .then(
      (errors): CheckResponse => ({ ok: true, errors }),
      (error): CheckResponse => {
        if (error instanceof RateLimitedError) {
          return { ok: false, reason: 'rate-limited', retryAfterMs: error.retryAfterMs };
        }
        if (error instanceof LlmFailedError) return { ok: false, reason: 'llm-failed', failure: error.failure };
        return { ok: false, reason: 'failed' };
      },
    );
}
