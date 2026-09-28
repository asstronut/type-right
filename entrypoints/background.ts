import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { checkText } from '../lib/checker';
import { createLanguageToolEngine } from '../lib/engines/language-tool';
import type { CheckFieldMessage, CheckFieldResponse } from '../lib/messages';

export default defineBackground(() => {
  const languageTool = createLanguageToolEngine({
    apiUrl: 'https://api.languagetool.org',
    language: 'en-US',
  });

  browser.runtime.onMessage.addListener((message: CheckFieldMessage) => {
    if (message?.type !== 'check-field') return;

    return checkText(message.text, { languageTool }).then(
      (errors): CheckFieldResponse => ({ errors }),
    );
  });
});
