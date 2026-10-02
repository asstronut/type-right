import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { RateLimitedError } from '../lib/engine';
import { createGlmEngine } from '../lib/engines/glm';
import { createLanguageToolEngine } from '../lib/engines/language-tool';
import type { CheckError } from '../lib/errors';
import type { CheckFieldMessage, CheckFieldResponse, CheckSentenceMessage } from '../lib/messages';
import { languageToolConfig, type Settings } from '../lib/settings';
import { store } from '../lib/store';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== 'install') return;
    if ((await store.getSettings()).llmConsent) return;
    await browser.tabs.create({ url: browser.runtime.getURL('/consent.html') });
  });

  browser.runtime.onMessage.addListener((message: CheckFieldMessage | CheckSentenceMessage) => {
    if (message?.type === 'check-field') {
      return respond((settings) => createLanguageToolEngine(languageToolConfig(settings)).check(message.text));
    }
    if (message?.type === 'check-sentence') {
      return respond((settings) => {
        // The content script checks this too; this is the last line before text leaves the browser.
        if (!settings.llmConsent || !settings.llmApiKey) throw new Error('LLM not allowed');
        return createGlmEngine({ apiKey: settings.llmApiKey }).check(message.text);
      });
    }
  });
});

/** Settings are read per check so a change on the Options page applies to the next keystroke. */
function respond(check: (settings: Settings) => Promise<CheckError[]>): Promise<CheckFieldResponse> {
  return store
    .getSettings()
    .then(check)
    .then(
      (errors): CheckFieldResponse => ({ ok: true, errors }),
      (error): CheckFieldResponse =>
        error instanceof RateLimitedError
          ? { ok: false, reason: 'rate-limited', retryAfterMs: error.retryAfterMs }
          : { ok: false, reason: 'failed' },
    );
}
