import type { Slip } from '../../lib/slips';
import type { ApplyResult } from './fields/field';
import { HoverCard } from './hover-card';
import type { SlipHit } from './underlines';

/** How long the pointer must rest on one underline before its card opens. */
const OPEN_DELAY_MS = 300;
/** Grace period for the pointer to travel from the underline onto the card. */
const CLOSE_DELAY_MS = 250;

const APPLY_NOTES: Partial<Record<ApplyResult, string>> = {
  unchanged: "This editor didn't take the fix. Retype it yourself.",
  changedWrongly: 'Apply went wrong here. Press Ctrl+Z to undo it.',
};

/** What the Hover card's buttons do for the Field whose Slip it shows. */
export interface HoverTarget {
  /** The Field's text the Slip flags, as it is now. */
  textOf(slip: Slip): string;
  canApply(slip: Slip): boolean;
  /** Replaces the Slip's text with `suggestion`, unless it no longer reads `flagged`. */
  apply(slip: Slip, flagged: string, suggestion: string): Promise<ApplyResult>;
  ignore(slip: Slip): void;
  addToDictionary(word: string): void;
}

interface Shown {
  target: HoverTarget;
  slip: Slip;
}

interface Pending extends Shown {
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Opens the page's Hover card when the pointer rests on an underline, keeps it
 * open while the pointer is on the underline or the card, and closes it when
 * the pointer moves away or the user types.
 */
export class HoverController {
  private readonly card = new HoverCard({
    onPointerEnter: () => {
      this.pointerOnCard = true;
      this.cancelClose();
    },
    onPointerLeave: () => {
      this.pointerOnCard = false;
      this.scheduleClose();
    },
  });
  private pointerOnCard = false;
  private shown: Shown | null = null;
  private pending: Pending | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new AbortController();

  constructor() {
    // The card is placed against the underline's viewport position, so it can't follow a page scroll.
    document.addEventListener('scroll', (event) => {
      if (!this.card.contains(event.target)) this.close();
    }, { capture: true, signal: this.listeners.signal });
    window.addEventListener('resize', () => this.close(), { signal: this.listeners.signal });
  }

  point(target: HoverTarget, hit: SlipHit | undefined): void {
    if (!hit) {
      if (this.pending?.target === target) this.cancelPending();
      if (this.shown?.target === target) this.scheduleClose();
      return;
    }
    if (this.shown && isSame(this.shown, target, hit.slip)) {
      this.cancelClose();
      return;
    }
    if (this.pending && isSame(this.pending, target, hit.slip)) return;

    // A new underline: restart the delay, so sweeping across text never opens a card.
    this.cancelPending();
    this.pending = {
      target,
      slip: hit.slip,
      timer: setTimeout(() => {
        this.pending = null;
        this.open(target, hit);
      }, OPEN_DELAY_MS),
    };
  }

  closeFor(target: HoverTarget): void {
    if (this.pending?.target === target) this.cancelPending();
    if (this.shown?.target === target) this.hide();
  }

  private open(target: HoverTarget, hit: SlipHit, note?: string): void {
    const { slip, rect } = hit;
    this.cancelClose();
    const flagged = target.textOf(slip);
    this.card.show(
      {
        slip,
        onApply:
          !note && slip.kind === 'spelling' && target.canApply(slip)
            ? (suggestion) => {
                this.close();
                void target.apply(slip, flagged, suggestion).then((result) => {
                  const reason = APPLY_NOTES[result];
                  if (reason) this.open(target, hit, reason);
                });
              }
            : undefined,
        note,
        onIgnore: () => {
          this.close();
          target.ignore(slip);
        },
        // A multi-word span (the LLM may quote one) isn't a word to learn.
        onAddToDictionary:
          slip.kind === 'spelling' && !/\s/.test(flagged.trim())
            ? () => {
                this.close();
                target.addToDictionary(flagged);
              }
            : undefined,
      },
      rect,
    );
    this.shown = { target, slip };
  }

  close(): void {
    this.cancelPending();
    this.hide();
  }

  /** Stops listening to the page and takes the card off it for good. */
  destroy(): void {
    this.listeners.abort();
    this.close();
    this.card.destroy();
  }

  private hide(): void {
    this.cancelClose();
    this.shown = null;
    this.pointerOnCard = false;
    this.card.hide();
  }

  private scheduleClose(): void {
    if (!this.shown || this.closeTimer || this.pointerOnCard) return;
    this.closeTimer = setTimeout(() => this.hide(), CLOSE_DELAY_MS);
  }

  private cancelClose(): void {
    clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
  }

  private cancelPending(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }
}

function isSame(shown: Shown, target: HoverTarget, slip: Slip): boolean {
  return shown.target === target && shown.slip.start === slip.start && shown.slip.end === slip.end && shown.slip.id === slip.id;
}
