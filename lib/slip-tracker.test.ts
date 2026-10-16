import { describe, expect, it } from 'vitest';
import { createSlipTracker, type SlipTracker } from './slip-tracker';
import { makeSlipId, type Slip, type SlipKind, type SlipSource } from './slips';

/** A Slip `source` found on `word` at `start` in the text it was given. */
function slip(source: SlipSource, word: string, start: number, kind: SlipKind = 'spelling'): Slip {
  return {
    id: makeSlipId(kind, word),
    start,
    end: start + word.length,
    kind,
    type: kind === 'spelling' ? 'Spelling mistake' : 'Agreement',
    explanation: `Problem with "${word}".`,
    suggestions: [],
    source,
  };
}

/** A tracker holding `text`, with `found` put in place across the whole text. */
function trackerWith(text: string, found: Slip[]): SlipTracker {
  const tracker = createSlipTracker();
  tracker.applyEdit(text);
  for (const source of ['languagetool', 'llm'] as const) {
    tracker.replaceSlips(
      source,
      { start: 0, end: text.length },
      found.filter((s) => s.source === source),
    );
  }
  return tracker;
}

/** Where each Slip sits, as the flagged text, to read assertions at a glance. */
function flagged(tracker: SlipTracker, slips = tracker.slips()): string[] {
  return slips.map((s) => `${s.source}:${tracker.text().slice(s.start, s.end)}@${s.start}`);
}

describe('createSlipTracker', () => {
  describe('applyEdit', () => {
    it('shifts a Slip after the edit by the edit length', () => {
      const tracker = trackerWith('I recieve it.', [slip('languagetool', 'recieve', 2)]);

      tracker.applyEdit('Now I recieve it.');

      expect(flagged(tracker)).toEqual(['languagetool:recieve@6']);
    });

    it('keeps a Slip before the edit where it was', () => {
      const tracker = trackerWith('I recieve it.', [slip('llm', 'recieve', 2)]);

      tracker.applyEdit('I recieve it all.');

      expect(flagged(tracker)).toEqual(['llm:recieve@2']);
    });

    it('drops a Slip whose word the edit changes, from either Engine', () => {
      const tracker = trackerWith('I recieve a apple.', [
        slip('languagetool', 'recieve', 2),
        slip('llm', 'a apple', 10, 'grammar'),
      ]);

      tracker.applyEdit('I receive an apple.');

      expect(flagged(tracker)).toEqual([]);
    });

    it('keeps a Slip when a space is typed right after its word', () => {
      const tracker = trackerWith('I recieve', [slip('languagetool', 'recieve', 2)]);

      tracker.applyEdit('I recieve ');

      expect(flagged(tracker)).toEqual(['languagetool:recieve@2']);
    });

    it('drops a Slip when a letter is typed right after its word', () => {
      const tracker = trackerWith('I recieve', [slip('languagetool', 'recieve', 2)]);

      tracker.applyEdit('I recieved');

      expect(flagged(tracker)).toEqual([]);
    });

    it('drops a Slip when a letter is typed right before its word', () => {
      const tracker = trackerWith('I recieve', [slip('languagetool', 'recieve', 2)]);

      tracker.applyEdit('I precieve');

      expect(flagged(tracker)).toEqual([]);
    });

    it('keeps and shifts a Slip when a space is typed right before its word', () => {
      const tracker = trackerWith('I recieve', [slip('languagetool', 'recieve', 2)]);

      tracker.applyEdit('I  recieve');

      expect(flagged(tracker)).toEqual(['languagetool:recieve@3']);
    });

    it('changes nothing when the text is the same', () => {
      const tracker = trackerWith('I recieve it.', [slip('languagetool', 'recieve', 2)]);

      expect(tracker.applyEdit('I recieve it.')).toBe(false);
      expect(flagged(tracker)).toEqual(['languagetool:recieve@2']);
    });
  });

  describe('dirty span', () => {
    it('starts out clean', () => {
      expect(createSlipTracker().dirty()).toBeNull();
    });

    it('covers what an edit inserted', () => {
      const tracker = createSlipTracker();

      tracker.applyEdit('Hello there.');

      expect(tracker.dirty()).toEqual({ start: 0, end: 12 });
    });

    it('grows to cover every edit since it was cleared', () => {
      const tracker = createSlipTracker();
      tracker.applyEdit('One. Two. Three.');
      tracker.clearDirty();

      tracker.applyEdit('One. Two! Three.');
      tracker.applyEdit('One. Two! Three!');

      expect(tracker.dirty()).toEqual({ start: 8, end: 16 });
    });

    it('moves with the text when an earlier edit shifts it', () => {
      const tracker = createSlipTracker();
      tracker.applyEdit('One. Two.');
      tracker.clearDirty();
      tracker.applyEdit('One. Two!');

      tracker.applyEdit('Well, one. Two!');

      expect(tracker.dirty()).toEqual({ start: 0, end: 15 });
    });

    it('moves its start to a position, keeping its end', () => {
      const tracker = createSlipTracker();
      tracker.applyEdit('First paragraph.\n\nSecond one.');

      tracker.moveDirtyStart(18);

      expect(tracker.dirty()).toEqual({ start: 18, end: 29 });
    });

    it('stays clean when its start is moved while clean', () => {
      const tracker = createSlipTracker();
      tracker.applyEdit('Hello.');
      tracker.clearDirty();

      tracker.moveDirtyStart(3);

      expect(tracker.dirty()).toBeNull();
    });
  });

  describe('replaceSlips', () => {
    it('puts found Slips in place relative to the span, replacing only that Engine’s Slips there', () => {
      const tracker = trackerWith('I recieve it.\n\nYou recieve it.', [
        slip('languagetool', 'I', 0, 'grammar'),
        slip('languagetool', 'it', 28, 'grammar'),
        slip('llm', 'recieve', 19),
      ]);

      tracker.replaceSlips('languagetool', { start: 15, end: 31 }, [slip('languagetool', 'recieve', 4)]);

      expect(flagged(tracker)).toEqual(['languagetool:I@0', 'llm:recieve@19']);
    });

    it('keeps a Slip that only touches the span’s edge', () => {
      const tracker = trackerWith('One. Two.', [slip('llm', 'One.', 0, 'grammar')]);

      tracker.replaceSlips('llm', { start: 4, end: 9 }, []);

      expect(flagged(tracker)).toEqual(['llm:One.@0']);
    });

    it('also drops Slips touching the span’s edges when asked', () => {
      const tracker = trackerWith('One. Two.', [slip('languagetool', 'One.', 0, 'grammar')]);

      tracker.replaceSlips('languagetool', { start: 4, end: 9 }, [], { dropTouching: true });

      expect(flagged(tracker)).toEqual([]);
    });
  });

  describe('clearSlips', () => {
    it('drops one Engine’s Slips and says it held some', () => {
      const tracker = trackerWith('I recieve a apple.', [
        slip('languagetool', 'recieve', 2),
        slip('llm', 'a apple', 10, 'grammar'),
      ]);

      expect(tracker.clearSlips('llm')).toBe(true);
      expect(flagged(tracker)).toEqual(['languagetool:recieve@2']);
    });

    it('says when the Engine held none', () => {
      const tracker = trackerWith('I recieve it.', [slip('languagetool', 'recieve', 2)]);

      expect(tracker.clearSlips('llm')).toBe(false);
    });
  });

  describe('version', () => {
    it('changes with every edit, so a check can tell its text went stale', () => {
      const tracker = createSlipTracker();
      tracker.applyEdit('Hello.');
      const checked = tracker.version();

      tracker.applyEdit('Hello!');

      expect(tracker.version()).not.toBe(checked);
    });

    it('stays the same when the text does', () => {
      const tracker = createSlipTracker();
      tracker.applyEdit('Hello.');
      const checked = tracker.version();

      tracker.applyEdit('Hello.');

      expect(tracker.version()).toBe(checked);
    });
  });

  describe('slips', () => {
    it('lists both Engines’ Slips in text order', () => {
      const tracker = trackerWith('I recieve a apple.', [
        slip('llm', 'a apple', 10, 'grammar'),
        slip('languagetool', 'recieve', 2),
      ]);

      expect(flagged(tracker)).toEqual(['languagetool:recieve@2', 'llm:a apple@10']);
    });

    it('keeps only the LLM Slip where both Engines flag the same words', () => {
      const tracker = trackerWith('I recieve a apple.', [
        slip('languagetool', 'recieve', 2),
        slip('languagetool', 'a apple', 10, 'grammar'),
        slip('llm', 'apple', 12, 'grammar'),
      ]);

      expect(flagged(tracker)).toEqual(['languagetool:recieve@2', 'llm:apple@12']);
    });

    it('keeps a LanguageTool Slip that only touches an LLM Slip’s edge', () => {
      const tracker = trackerWith('I recieve a apple.', [
        slip('languagetool', 'I recieve', 0, 'grammar'),
        slip('llm', ' a apple', 9, 'grammar'),
      ]);

      expect(flagged(tracker)).toEqual(['languagetool:I recieve@0', 'llm: a apple@9']);
    });

    it('drops spelling Slips on Dictionary words before the merge, so they hide nothing', () => {
      const tracker = trackerWith('I recieve it.', [
        slip('languagetool', 'I recieve', 0, 'grammar'),
        slip('llm', 'recieve', 2),
      ]);

      const slips = tracker.slips((word) => word === 'recieve');

      expect(flagged(tracker, slips)).toEqual(['languagetool:I recieve@0']);
    });

    it('keeps grammar and wording Slips on Dictionary words', () => {
      const tracker = trackerWith('I recieve it.', [slip('llm', 'recieve', 2, 'grammar')]);

      const slips = tracker.slips((word) => word === 'recieve');

      expect(flagged(tracker, slips)).toEqual(['llm:recieve@2']);
    });

    it('drops Ignore here Slips after the merge, taking the LanguageTool Slips an LLM Slip hid with it', () => {
      const llmSlip = slip('llm', 'recieve', 2);
      const tracker = trackerWith('I recieve it. You recieve it.', [
        slip('languagetool', 'recieve', 2),
        llmSlip,
        slip('languagetool', 'it', 26, 'grammar'),
      ]);

      tracker.ignore(llmSlip.id);

      expect(flagged(tracker)).toEqual(['languagetool:it@26']);
    });

    it('hides an Ignore here Slip wherever it appears, re-found ones included', () => {
      const tracker = trackerWith('I recieve it.', [slip('languagetool', 'recieve', 2)]);
      tracker.ignore(makeSlipId('spelling', 'recieve'));

      tracker.applyEdit('I recieve it. You recieve it.');
      tracker.replaceSlips('languagetool', { start: 14, end: 29 }, [slip('languagetool', 'recieve', 4)]);

      expect(flagged(tracker)).toEqual([]);
    });
  });
});
