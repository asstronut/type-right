import { ERROR_KINDS, type ErrorKind } from './errors';

/** One Error as the Popup counts it: `key` tells distinct Errors apart. */
export interface ErrorSighting {
  key: string;
  kind: ErrorKind;
  type: string;
}

/** The Popup's counts of distinct Errors, by kind then type label. */
export interface ErrorTally {
  /** Keys of the Errors already counted, oldest first. */
  seen: string[];
  counts: Partial<Record<ErrorKind, Record<string, number>>>;
}

export const EMPTY_TALLY: ErrorTally = { seen: [], counts: {} };

/** Keeps the stored tally bounded; forgetting an old key only risks counting that Error again. */
const MAX_SEEN = 5_000;

/** `tally` with each sighting not counted before added to its type's count. */
export function addToTally(tally: ErrorTally, sightings: readonly ErrorSighting[]): ErrorTally {
  const seen = new Set(tally.seen);
  const counts = structuredClone(tally.counts);
  for (const { key, kind, type } of sightings) {
    if (seen.has(key)) continue;
    seen.add(key);
    const byType = (counts[kind] ??= {});
    byType[type] = (byType[type] ?? 0) + 1;
  }
  if (seen.size === tally.seen.length) return tally;
  return { seen: [...seen].slice(-MAX_SEEN), counts };
}

/** Drops anything missing or malformed in a stored tally. */
export function normalizeTally(raw: unknown): ErrorTally {
  const value = (raw ?? {}) as Partial<ErrorTally>;
  const seen = Array.isArray(value.seen) ? value.seen.filter((key) => typeof key === 'string') : [];
  const counts: ErrorTally['counts'] = {};
  for (const kind of ERROR_KINDS) {
    const byType = value.counts?.[kind];
    if (!byType || typeof byType !== 'object') continue;
    const valid = Object.entries(byType).filter(([, n]) => Number.isInteger(n) && n > 0);
    if (valid.length) counts[kind] = Object.fromEntries(valid);
  }
  return { seen, counts };
}
