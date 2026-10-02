import { browser } from 'wxt/browser';
import { LLM_PROVIDERS } from '../../lib/llm-providers';
import type { Settings } from '../../lib/settings';
import { store } from '../../lib/store';

const status = document.querySelector<HTMLParagraphElement>('#status')!;

/** Names the selected provider, the one consent is being asked for. */
function showProvider(settings: Settings): void {
  const provider = LLM_PROVIDERS[settings.llmProvider];
  for (const el of document.querySelectorAll('.llm-name')) el.textContent = provider.name;
  for (const el of document.querySelectorAll('.llm-recipient')) el.textContent = provider.recipient;
}

function show(consent: boolean, settings: Settings): void {
  status.textContent = consent
    ? `Accepted. Add your ${LLM_PROVIDERS[settings.llmProvider].name} API key in Settings to turn on the wording check.`
    : 'Text will only be sent to LanguageTool. You can change this in Settings.';
}

document.querySelector('#accept')!.addEventListener('click', async () => {
  const settings = await store.saveSettings({ llmConsent: true });
  show(true, settings);
  if (!settings.llmApiKey) await browser.runtime.openOptionsPage();
});

document.querySelector('#decline')!.addEventListener('click', async () => {
  show(false, await store.saveSettings({ llmConsent: false }));
});

// The provider may be changed in Settings while this page is open.
store.watchSettings(showProvider);
showProvider(await store.getSettings());
