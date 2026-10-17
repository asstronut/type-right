import { browser } from 'wxt/browser';
import { LLM_PROVIDERS, type LlmProviderId } from '../../lib/llm-providers';
import type { Settings } from '../../lib/settings';
import { store } from '../../lib/store';

/**
 * What the page shows. The form until the LLM is set up: consent and a key for
 * the stored Provider, or the user skipped it here.
 */
type View = { kind: 'form' } | { kind: 'accepted'; provider: LlmProviderId } | { kind: 'declined' };

const form = document.querySelector<HTMLFormElement>('#setup')!;
const providers = document.querySelector<HTMLFieldSetElement>('#providers')!;
const keyInput = document.querySelector<HTMLInputElement>('#llmApiKey')!;
const keyUrl = document.querySelector<HTMLAnchorElement>('#keyUrl')!;
const accept = document.querySelector<HTMLButtonElement>('#accept')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const done = document.querySelector<HTMLParagraphElement>('#done')!;
const settingsLink = document.querySelector<HTMLParagraphElement>('#settingsLink')!;

/** The last Settings shown. */
let settings: Settings | undefined;
/** The Provider whose wording check the user skipped on this page, while it is still the stored one. */
let declinedFor: LlmProviderId | undefined;
/** The Provider chosen in the form. */
let selected: LlmProviderId;
/** The key typed for each Provider, so switching cards and back keeps it; never sent to another Provider. */
let drafts: Partial<Record<LlmProviderId, string>> = {};

function viewOf({ llmConsent, llmApiKey, llmProvider }: Settings): View {
  if (llmConsent && llmApiKey) return { kind: 'accepted', provider: llmProvider };
  if (declinedFor) return { kind: 'declined' };
  return { kind: 'form' };
}

function render(shown: Settings): void {
  const current = viewOf(shown);
  form.hidden = current.kind !== 'form';
  done.hidden = settingsLink.hidden = true;
  switch (current.kind) {
    case 'form':
      status.textContent = '';
      renderForm();
      break;
    case 'accepted':
      status.textContent = `${LLM_PROVIDERS[current.provider].name} checks are on.`;
      done.textContent = 'Type in any text box, including in tabs that were already open, and Type Right checks it as you write.';
      done.hidden = false;
      break;
    case 'declined':
      status.textContent = 'Only LanguageTool will check your text.';
      done.textContent = 'You can turn on the wording check later in Settings.';
      done.hidden = settingsLink.hidden = false;
      break;
  }
}

function renderForm(): void {
  const provider = LLM_PROVIDERS[selected];
  for (const radio of providers.querySelectorAll('input')) radio.checked = radio.value === selected;
  keyInput.value = drafts[selected] ?? '';
  keyUrl.href = provider.keyUrl;
  keyUrl.textContent = `Get a ${provider.name} key`;
  document.querySelector('#keyName')!.textContent = provider.keyName;
  for (const el of document.querySelectorAll('.llm-name')) el.textContent = provider.name;
  for (const el of document.querySelectorAll('.llm-recipient')) el.textContent = provider.recipient;
  updateAccept();
}

function updateAccept(): void {
  accept.disabled = keyInput.value.trim() === '';
}

/**
 * Shows `next`. The form is refilled only when the LLM settings changed (here or
 * in another tab), so a key being typed survives unrelated saves such as a
 * Dictionary word.
 */
function show(next: Settings): void {
  const llmChanged =
    !settings ||
    next.llmProvider !== settings.llmProvider ||
    next.llmApiKey !== settings.llmApiKey ||
    next.llmConsent !== settings.llmConsent;
  settings = next;
  if (!llmChanged) return;
  if (next.llmConsent || next.llmProvider !== declinedFor) declinedFor = undefined;
  selected = next.llmProvider;
  drafts = { [next.llmProvider]: next.llmApiKey };
  render(next);
}

function providerCard(id: LlmProviderId): HTMLLabelElement {
  const card = document.createElement('label');
  card.className = 'card';
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'llmProvider';
  radio.value = id;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = LLM_PROVIDERS[id].name;
  const recipient = document.createElement('span');
  recipient.className = 'recipient';
  recipient.textContent = LLM_PROVIDERS[id].recipient;
  card.append(radio, name, recipient);
  return card;
}

providers.append(...(Object.keys(LLM_PROVIDERS) as LlmProviderId[]).map(providerCard));

providers.addEventListener('change', (event) => {
  drafts[selected] = keyInput.value;
  selected = (event.target as HTMLInputElement).value as LlmProviderId;
  renderForm();
});

// A pointer click on a card moves on to its key. Arrow keys also select a card,
// and keep focus on the cards so the next one can be reached.
providers.addEventListener('click', (event) => {
  if (event.detail > 0) keyInput.focus();
});

keyInput.addEventListener('input', updateAccept);

// The Provider and key go first: changing the Provider revokes consent, so consent
// is written once the Provider is settled. The second write repeats the key because
// the first drops it when it equals the old Provider's key.
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = keyInput.value.trim();
  if (!key) return;
  accept.disabled = true;
  await store.saveSettings({ llmProvider: selected, llmApiKey: key });
  await store.saveSettings({ llmApiKey: key, llmConsent: true });
});

document.querySelector('#decline')!.addEventListener('click', async () => {
  settings = await store.saveSettings({ llmConsent: false });
  declinedFor = settings.llmProvider;
  render(settings);
});

settingsLink.querySelector('a')!.addEventListener('click', (event) => {
  event.preventDefault();
  void browser.runtime.openOptionsPage();
});

// Settings may change in another tab (the Options page) while this page is open.
store.watchSettings(show);
show(await store.getSettings());
