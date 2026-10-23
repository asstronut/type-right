import { createBadge } from '../badge';
import type { HoverController, HoverTarget } from '../hover';
import type { Underlines } from '../underlines';
import { createFieldChecker, type CheckEngines, type CheckSite } from '../../../lib/checker';
import type { LlmHealth, PageLlmHealth } from '../../../lib/llm-health';
import type { TextSpan } from '../../../lib/slip-tracker';
import type { SlipSighting } from '../../../lib/slip-tally';
import type { Slip } from '../../../lib/slips';

/** A snapshot of a Field's text that carries the way to range over it, so ranges always match the text they came with. */
export interface FieldRead {
  text: string;
  /** Spans that are never flagged (chips, emoji); textareas have none. Used from #72. */
  neverFlag: TextSpan[];
  /** True while an IME composition is in progress. Used from #74. */
  composing: boolean;
  rangeFor(span: TextSpan): AbstractRange;
}

/** What differs between the kinds of Field (textarea, Rich editor); the rest is `createField`. */
export interface FieldAdapter {
  readonly element: HTMLElement;
  /** Delivers a read at attach (when the kind's rules allow it) and after every change, until `signal` aborts. */
  watch(onRead: (read: FieldRead) => void, signal: AbortSignal): void;
  canApply(slip: Slip): boolean;
  /** The edit itself: select the Slip's text and replace it with `suggestion`. */
  replace(slip: Slip, suggestion: string): Promise<void>;
}

export interface FieldDeps {
  engines: CheckEngines;
  site: CheckSite;
  llmHealth: PageLlmHealth;
  underlines: Underlines;
  hover: Pick<HoverController, 'point' | 'changed' | 'close'>;
  addToDictionary(word: string): void;
  onSlipsSeen(sightings: SlipSighting[]): void;
  /** Asked on every read: true once the extension reloaded, and the read is dropped. */
  noticeReload(): boolean;
}

export interface Field {
  /** Re-renders the Slips, after a Settings change such as the Dictionary. */
  refresh(): void;
  /** Lets the Field count its Slips again, after the counts are reset. */
  forgetReported(): void;
  showLlmHealth(health: LlmHealth): void;
  /** Takes the Field off the page: its checks, underlines, badge and Hover card. */
  dispose(): void;
}

/**
 * Everything a Field does that is the same for every kind: checks its text
 * as it is read, underlines the Slips, shows the badge and answers the Hover
 * card's buttons.
 */
export function createField(adapter: FieldAdapter, deps: FieldDeps): Field {
  const { element } = adapter;
  const { underlines, hover } = deps;
  const listeners = new AbortController();
  /** The newest read, which the Slips on screen are drawn from. */
  let latest: FieldRead | undefined;

  const checker = createFieldChecker({
    engines: deps.engines,
    site: deps.site,
    llmHealth: deps.llmHealth,
    onChange: render,
    onSlipsSeen: deps.onSlipsSeen,
  });
  const badge = createBadge(element);
  badge.setLlmHealth(deps.llmHealth.health());

  function render(slips: Slip[]): void {
    if (!latest) return;
    const { text, rangeFor } = latest;
    underlines.draw(
      field,
      slips
        .filter((slip) => slip.end > slip.start && slip.end <= text.length)
        .map((slip) => ({ slip, range: rangeFor(slip) })),
    );
  }

  const target: HoverTarget = {
    textOf: (slip) => latest?.text.slice(slip.start, slip.end) ?? '',
    canApply: (slip) => adapter.canApply(slip),
    apply(slip, flagged, suggestion) {
      // The text moved on since the card opened; replacing by offset would hit the wrong words.
      if (latest?.text.slice(slip.start, slip.end) !== flagged) return;
      void adapter.replace(slip, suggestion);
    },
    ignore(slip) {
      checker.ignore(slip.id);
    },
    addToDictionary: deps.addToDictionary,
  };

  let frame: number | undefined;
  let pointer = { x: 0, y: 0 };
  function cancelFrame(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }
  const { signal } = listeners;
  element.addEventListener('mousemove', (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    frame ??= requestAnimationFrame(() => {
      frame = undefined;
      hover.point(target, underlines.hitAt(field, pointer.x, pointer.y));
    });
  }, { passive: true, signal });
  element.addEventListener('mouseleave', () => {
    cancelFrame();
    hover.point(target, undefined);
  }, { signal });
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hover.close();
  }, { signal });

  const field: Field = {
    refresh: () => render(checker.slips()),
    forgetReported: () => checker.forgetReported(),
    showLlmHealth: (health) => badge.setLlmHealth(health),
    dispose() {
      listeners.abort();
      cancelFrame();
      latest = undefined;
      checker.dispose();
      underlines.forget(field);
      badge.destroy();
      hover.changed(target);
    },
  };

  adapter.watch((read) => {
    // The next edit after a reload is when it's noticed at the latest.
    if (deps.noticeReload()) return;
    latest = read;
    hover.changed(target);
    // Shifted/trimmed underlines on every edit; the debounced re-check then fills in anything new.
    render(checker.update(read.text));
  }, signal);

  return field;
}
