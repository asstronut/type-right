import { storage } from 'wxt/utils/storage';
import { addToTally, EMPTY_TALLY, normalizeTally, type ErrorSighting, type ErrorTally } from './error-tally';
import { DEFAULT_SETTINGS, dictionaryKey, mergeSettings, normalizeSettings, type Settings } from './settings';

/** Local, not sync: the API key shouldn't be copied to other browsers' profiles. */
const settingsItem = storage.defineItem<Partial<Settings>>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

const tallyItem = storage.defineItem<ErrorTally>('local:errorTally', {
  fallback: EMPTY_TALLY,
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

  /** Adds `site` to one of the site lists (a no-op if it's already there). */
  async addSite(list: 'excludedSites' | 'disabledSites', site: string): Promise<Settings> {
    const settings = await this.getSettings();
    return this.saveSettings({ [list]: [...settings[list], site] });
  },

  /** Calls `onChange` with the new Settings whenever any extension page saves them. */
  watchSettings(onChange: (settings: Settings) => void): () => void {
    return settingsItem.watch((value) => onChange(normalizeSettings(value)));
  },

  async getTally(): Promise<ErrorTally> {
    return normalizeTally(await tallyItem.getValue());
  },

  /**
   * Counts each Error not counted before. Not atomic: only the background
   * worker writes the tally, one write at a time, so no two writes overlap.
   */
  async recordErrors(sightings: ErrorSighting[]): Promise<void> {
    const current = await this.getTally();
    const next = addToTally(current, sightings);
    if (next !== current) await tallyItem.setValue(next);
  },

  /** Sets every count to zero and forgets which Errors were counted. */
  async resetTally(): Promise<void> {
    await tallyItem.setValue(EMPTY_TALLY);
  },

  watchTally(onChange: (tally: ErrorTally) => void): () => void {
    return tallyItem.watch((value) => onChange(normalizeTally(value)));
  },
};
