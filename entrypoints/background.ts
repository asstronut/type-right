import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { RateLimitedError } from '../lib/engine';
import { createGlmEngine } from '../lib/engines/glm';
import { createLanguageToolEngine } from '../lib/engines/language-tool';
import type { CheckError } from '../lib/errors';
import type { CheckMessage, CheckResponse } from '../lib/messages';
import { isLlmAllowed, languageToolConfig, type Settings } from '../lib/settings';
import { store } from '../lib/store';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== 'install') return;
    if ((await store.getSettings()).llmConsent) return;
    await browser.tabs.create({ url: browser.runtime.getURL('/consent.html') });
  });

  browser.runtime.onMessage.addListener((message: CheckMessage, sender) => {
    if (message?.type === 'check-field') {
      return respond((settings) => createLanguageToolEngine(languageToolConfig(settings)).check(message.text));
    }
    if (message?.type === 'check-sentence') {
      return respond((settings) => {
        // The checker gates this too; this is the last line before text leaves the browser.
        const hostname = sender.url ? new URL(sender.url).hostname : '';
        if (!hostname || !isLlmAllowed(hostname, settings)) throw new Error('LLM not allowed');
        return createGlmEngine({ apiKey: settings.llmApiKey }).check(message.text);
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
      (error): CheckResponse =>
        error instanceof RateLimitedError
          ? { ok: false, reason: 'rate-limited', retryAfterMs: error.retryAfterMs }
          : { ok: false, reason: 'failed' },
    );
}
