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
  neverFlag: TextSpan[];
  composing: boolean;
  rangeFor(span: TextSpan): AbstractRange;
}

/** What differs between the kinds of Field (textarea, Rich editor); the rest is `createField`. */
export interface FieldAdapter {
  readonly element: HTMLElement;
  /** Delivers a read at attach (when the kind's rules allow it) and after every change, until `signal` aborts. */
  watch(onRead: (read: FieldRead) => void, signal: AbortSignal): void;
  canApply(slip: Slip): boolean;
  /** Replaces the Slip's text with `suggestion`, unless the element's live text there no longer reads `flagged`. */
  replace(slip: Slip, flagged: string, suggestion: string): Promise<void>;
}

export interface FieldDeps {
  engines: CheckEngines;
  site: CheckSite;
  llmHealth: PageLlmHealth;
  underlines: Underlines;
  hover: Pick<HoverController, 'point' | 'closeFor' | 'close'>;
  addToDictionary(word: string): void;
  onSlipsSeen(sightings: SlipSighting[]): void;
  /** Asked on every read: true once the extension reloaded, and the read is dropped. */
  noticeReload(): boolean;
}

export interface Field {
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
    const { rangeFor } = latest;
    underlines.draw(field, slips.map((slip) => ({ slip, range: rangeFor(slip) })));
    badge.followMove();
  }

  const target: HoverTarget = {
    textOf: (slip) => latest?.text.slice(slip.start, slip.end) ?? '',
    canApply: (slip) => adapter.canApply(slip),
    apply(slip, flagged, suggestion) {
      void adapter.replace(slip, flagged, suggestion);
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
      hover.closeFor(target);
    },
  };

  adapter.watch((read) => {
    if (deps.noticeReload()) return;
    latest = read;
    hover.closeFor(target);
    render(checker.update(read.text));
  }, signal);

  return field;
}
