import { storage } from 'wxt/utils/storage';
import { addToTally, EMPTY_TALLY, normalizeTally, type SlipSighting, type SlipTally } from './slip-tally';
import { dictionaryKey, mergeSettings, normalizeSettings, type Settings } from './settings';

// Plain keys rather than storage.defineItem. An item reads storage as soon as it's defined, and in a
// content script Chrome starts after the extension has reloaded, that read rejects with nothing to catch it.

/** Local, not sync: the API key shouldn't be copied to other browsers' profiles. */
const SETTINGS_KEY = 'local:settings';

/** Keeps its pre-rename key, so counts saved before Errors became Slips survive. */
const TALLY_KEY = 'local:errorTally';

/** Typed access to the extension's persisted Settings. */
export const store = {
  async getSettings(): Promise<Settings> {
    return normalizeSettings(await storage.getItem<Partial<Settings>>(SETTINGS_KEY));
  },

  async saveSettings(changes: Partial<Settings>): Promise<Settings> {
    const next = mergeSettings(await this.getSettings(), changes);
    await storage.setItem(SETTINGS_KEY, next);
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
    return storage.watch<Partial<Settings>>(SETTINGS_KEY, (value) => onChange(normalizeSettings(value)));
  },

  async getTally(): Promise<SlipTally> {
    return normalizeTally(await storage.getItem(TALLY_KEY));
  },

  /**
   * Counts each Slip not counted before. Not atomic: only the background
   * worker writes the tally, one write at a time, so no two writes overlap.
   */
  async recordSlips(sightings: SlipSighting[]): Promise<void> {
    const current = await this.getTally();
    const next = addToTally(current, sightings);
    if (next !== current) await storage.setItem(TALLY_KEY, next);
  },

  /** Sets every count to zero and forgets which Slips were counted. */
  async resetTally(): Promise<void> {
    await storage.setItem(TALLY_KEY, EMPTY_TALLY);
  },

  watchTally(onChange: (tally: SlipTally) => void): () => void {
    return storage.watch(TALLY_KEY, (value) => onChange(normalizeTally(value)));
  },
};
