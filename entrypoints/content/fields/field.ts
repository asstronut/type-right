import { createBadge } from '../badge';
import type { HoverController, HoverTarget } from '../hover';
import { UNDERLINE_REACH_PX, type Underlines } from '../underlines';
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

export type ApplyResult = 'accepted' | 'unchanged' | 'changedWrongly' | 'inconclusive' | 'stale';

/** What an adapter's `replace` did: refused because the live text moved on, made the edit for certain (textarea), or tried an edit the editor may not have kept (Rich editor). */
export type ReplaceOutcome = 'stale' | 'replaced' | 'attempted';

export const APPLY_VERDICT_MS = 150;

/** What differs between the kinds of Field (textarea, Rich editor); the rest is `createField`. */
export interface FieldAdapter {
  readonly element: HTMLElement;
  /** Delivers a read at attach (when the kind's rules allow it) and after every change, until `signal` aborts. */
  watch(onRead: (read: FieldRead) => void, signal: AbortSignal): void;
  canApply(slip: Slip): boolean;
  /** Replaces the Slip's text with `suggestion`, unless the element's live text there no longer reads `flagged`. */
  replace(slip: Slip, flagged: string, suggestion: string): Promise<ReplaceOutcome>;
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
  /** An Apply in a Rich editor ended `unchanged` or `changedWrongly`: the page learns that editors there refuse fixes. */
  onApplyRefused(): void;
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
  let hasUnderlines = false;

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
    hasUnderlines = slips.length > 0;
    underlines.draw(field, slips.map((slip) => ({ slip, range: rangeFor(slip) })));
    badge.followMove();
  }

  const target: HoverTarget = {
    textOf: (slip) => latest?.text.slice(slip.start, slip.end) ?? '',
    canApply: (slip) => adapter.canApply(slip),
    async apply(slip, flagged, suggestion) {
      const before = latest?.text;
      if (before === undefined || before.slice(slip.start, slip.end) !== flagged) return 'stale';
      const outcome = await adapter.replace(slip, flagged, suggestion);
      if (outcome === 'stale') return 'stale';
      if (outcome === 'replaced') return 'accepted';

      const interfered = await userTypedBeforeVerdict();
      if (interfered || signal.aborted || !latest) return 'inconclusive';
      const expected = before.slice(0, slip.start) + suggestion + before.slice(slip.end);
      if (latest.text === expected) return 'accepted';
      deps.onApplyRefused();
      return latest.text === before ? 'unchanged' : 'changedWrongly';
    },
    ignore(slip) {
      checker.ignore(slip.id);
    },
    addToDictionary: deps.addToDictionary,
  };

  let interference: { happened: boolean } | undefined;
  async function userTypedBeforeVerdict(): Promise<boolean> {
    const watching = { happened: false };
    const waiting = new AbortController();
    const note = () => void (watching.happened = true);
    interference = watching;
    element.addEventListener('input', (event) => event.isTrusted && note(), { signal: waiting.signal });
    element.addEventListener('compositionstart', note, { signal: waiting.signal });
    await new Promise((resolve) => setTimeout(resolve, APPLY_VERDICT_MS));
    waiting.abort();
    interference = undefined;
    return watching.happened;
  }

  let frame: number | undefined;
  let pointer = { x: 0, y: 0 };
  function cancelFrame(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }
  const { signal } = listeners;
  function probe(event: MouseEvent): void {
    pointer = { x: event.clientX, y: event.clientY };
    frame ??= requestAnimationFrame(() => {
      frame = undefined;
      hover.point(target, underlines.hitAt(field, pointer.x, pointer.y));
    });
  }
  function leave(): void {
    cancelFrame();
    hover.point(target, undefined);
  }
  element.addEventListener('mousemove', probe, { passive: true, signal });
  element.addEventListener('mouseleave', leave, { signal });
  let underBox = false;
  document.addEventListener('mousemove', (event) => {
    const wasUnderBox = underBox;
    const inElement = event.target instanceof Node && element.contains(event.target);
    underBox = !inElement && hasUnderlines && isUnderBox(element, event);
    if (underBox) probe(event);
    else if (wasUnderBox && !inElement) leave();
  }, { passive: true, signal });
  document.documentElement.addEventListener('mouseleave', () => {
    if (underBox) leave();
    underBox = false;
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
    if (read.text !== latest?.text) hover.closeFor(target);
    latest = read;
    if (read.composing && interference) interference.happened = true;
    render(checker.update(read.text, { neverFlag: read.neverFlag, composing: read.composing }));
  }, signal);

  return field;
}

/** Pointer coordinates are whole pixels, so a box edge between two pixels counts from the pixel it falls in. */
function isUnderBox(element: HTMLElement, { clientX, clientY }: MouseEvent): boolean {
  const box = element.getBoundingClientRect();
  return box.width > 0 && clientX >= box.left && clientX <= box.right && clientY >= Math.floor(box.bottom) && clientY <= box.bottom + UNDERLINE_REACH_PX;
}
