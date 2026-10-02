import { browser } from 'wxt/browser';
import { normalizeSite, normalizeUrl, type EnglishVariant, type Settings } from '../../lib/settings';
import { store } from '../../lib/store';

const form = document.querySelector<HTMLFormElement>('#settings')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const save = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const control = <T>(name: string) => form.elements.namedItem(name) as unknown as T;

const llmApiKey = control<HTMLInputElement>('llmApiKey');
const llmConsent = control<HTMLInputElement>('llmConsent');
const languageToolUrl = control<HTMLInputElement>('languageToolUrl');
const excludedSites = control<HTMLTextAreaElement>('excludedSites');
const disabledSites = control<HTMLTextAreaElement>('disabledSites');
const englishVariant = control<RadioNodeList>('englishVariant');

/** The snapshot of the last filled Settings. */
let saved = '';

function fill(settings: Settings): void {
  llmApiKey.value = settings.llmApiKey;
  llmConsent.checked = settings.llmConsent;
  languageToolUrl.value = settings.languageToolUrl;
  excludedSites.value = settings.excludedSites.join('\n');
  disabledSites.value = settings.disabledSites.join('\n');
  englishVariant.value = settings.englishVariant;
  saved = snapshot();
  showError('');
  updateSave();
}

/** The raw form values, to tell whether the user has changed anything since the last fill. */
function snapshot(): string {
  return JSON.stringify([
    llmApiKey.value,
    llmConsent.checked,
    languageToolUrl.value,
    excludedSites.value,
    disabledSites.value,
    englishVariant.value,
  ]);
}

/** Enables Save only while the form differs from the stored Settings. */
function updateSave(): void {
  save.disabled = snapshot() === saved;
}

function showError(message: string): void {
  status.textContent = message;
}

/** Each non-blank line as a hostname; throws naming the first line that isn't one. */
function parseSites(textarea: HTMLTextAreaElement, label: string): string[] {
  const lines = textarea.value.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => {
    const site = normalizeSite(line);
    if (!site) throw new Error(`"${line}" in ${label} is not a site.`);
    return site;
  });
}

/**
 * The extension can only reach the hosts it has permission for, so a custom
 * LanguageTool server needs the user to grant access to it. Resolves true
 * without a prompt for hosts already granted.
 */
function requestHostPermission(url: string): Promise<boolean> {
  return browser.permissions.request({ origins: [`${new URL(url).origin}/*`] });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  save.disabled = true;
  try {
    const url = normalizeUrl(languageToolUrl.value);
    if (!url) throw new Error('The LanguageTool URL must start with http:// or https://.');
    const changes: Partial<Settings> = {
      llmApiKey: llmApiKey.value,
      llmConsent: llmConsent.checked,
      englishVariant: englishVariant.value as EnglishVariant,
      languageToolUrl: url,
      excludedSites: parseSites(excludedSites, 'Never send to the LLM'),
      disabledSites: parseSites(disabledSites, 'Turn Type Right off'),
    };
    // Requested before any other await: Chrome only allows the prompt during the click.
    if (!(await requestHostPermission(url))) {
      throw new Error(`Type Right needs permission to reach ${new URL(url).host} to use it.`);
    }
    fill(await store.saveSettings(changes));
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    updateSave();
  }
});

form.addEventListener('input', updateSave);

// Another tab (or the popup, later) may change Settings while this page is open.
store.watchSettings(fill);
fill(await store.getSettings());
