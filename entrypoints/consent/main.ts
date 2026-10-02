import { browser } from 'wxt/browser';
import { store } from '../../lib/store';

const status = document.querySelector<HTMLParagraphElement>('#status')!;

function show(consent: boolean): void {
  status.textContent = consent
    ? 'Accepted. Add your GLM API key in Settings to turn on the wording check.'
    : 'Text will only be sent to LanguageTool. You can change this in Settings.';
}

document.querySelector('#accept')!.addEventListener('click', async () => {
  const settings = await store.saveSettings({ llmConsent: true });
  show(true);
  if (!settings.llmApiKey) await browser.runtime.openOptionsPage();
});

document.querySelector('#decline')!.addEventListener('click', async () => {
  await store.saveSettings({ llmConsent: false });
  show(false);
});
