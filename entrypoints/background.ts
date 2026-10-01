import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { RateLimitedError } from '../lib/engine';
import { createLanguageToolEngine } from '../lib/engines/language-tool';
import type { CheckFieldMessage, CheckFieldResponse } from '../lib/messages';
import { languageToolConfig } from '../lib/settings';
import { store } from '../lib/store';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: CheckFieldMessage) => {
    if (message?.type !== 'check-field') return;

    // Settings are read per check so a change on the Options page applies to the next keystroke.
    return store
      .getSettings()
      .then((settings) => createLanguageToolEngine(languageToolConfig(settings)).check(message.text))
      .then(
        (errors): CheckFieldResponse => ({ ok: true, errors }),
        (error): CheckFieldResponse =>
          error instanceof RateLimitedError
            ? { ok: false, reason: 'rate-limited', retryAfterMs: error.retryAfterMs }
            : { ok: false, reason: 'failed' },
      );
  });
});
