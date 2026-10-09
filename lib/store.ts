import { storage } from 'wxt/utils/storage';
import { DEFAULT_SETTINGS, dictionaryKey, mergeSettings, normalizeSettings, type Settings } from './settings';

/** Local, not sync: the API key shouldn't be copied to other browsers' profiles. */
const settingsItem = storage.defineItem<Partial<Settings>>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

/** Typed access to the extension's persisted Settings. */
export const store = {
  async getSettings(): Promise<Settings> {
    return normalizeSettings(await settingsItem.getValue());
  },

  async saveSettings(changes: Partial<Settings>): Promise<Settings> {
    const next = mergeSettings(await this.getSettings(), changes);
    await settingsItem.setValue(next);
    return next;
  },

  /** Adds `word` to the personal dictionary (a no-op if it's already there, in any case). */
  async addToDictionary(word: string): Promise<Settings> {
    const { dictionary } = await this.getSettings();
    return this.saveSettings({ dictionary: [...dictionary, word] });
  },

  /** Removes `word` from the personal dictionary, matching it in any case. */
  async removeFromDictionary(word: string): Promise<Settings> {
    const { dictionary } = await this.getSettings();
    return this.saveSettings({ dictionary: dictionary.filter((entry) => dictionaryKey(entry) !== dictionaryKey(word)) });
  },

  /** Calls `onChange` with the new Settings whenever any extension page saves them. */
  watchSettings(onChange: (settings: Settings) => void): () => void {
    return settingsItem.watch((value) => onChange(normalizeSettings(value)));
  },
};
