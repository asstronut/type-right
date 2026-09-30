import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { RateLimitedError } from '../lib/engine';
import { createLanguageToolEngine } from '../lib/engines/language-tool';
import type { CheckFieldMessage, CheckFieldResponse } from '../lib/messages';

export default defineBackground(() => {
  const languageTool = createLanguageToolEngine({
    apiUrl: 'https://api.languagetool.org',
    language: 'en-US',
  });

  browser.runtime.onMessage.addListener((message: CheckFieldMessage) => {
    if (message?.type !== 'check-field') return;

    return languageTool.check(message.text).then(
      (errors): CheckFieldResponse => ({ ok: true, errors }),
      (error): CheckFieldResponse =>
        error instanceof RateLimitedError
          ? { ok: false, reason: 'rate-limited', retryAfterMs: error.retryAfterMs }
          : { ok: false, reason: 'failed' },
    );
  });
});
