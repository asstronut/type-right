import type { CheckError } from '../../lib/errors';
import type { FieldOverlay, ErrorHit } from './field-overlay';
import { HoverCard } from './hover-card';

/** How long the pointer must rest on one underline before its card opens. */
const OPEN_DELAY_MS = 300;
/** Grace period for the pointer to travel from the underline onto the card. */
const CLOSE_DELAY_MS = 250;

/** What the Hover card's buttons do for one field. */
export interface HoverActions {
  ignore(error: CheckError): void;
  addToDictionary(word: string): void;
}

interface Pending {
  error: CheckError;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Opens the page's Hover card when the pointer rests on an underline, keeps it
 * open while the pointer is on the underline or the card, and closes it when
 * the pointer moves away or the user types.
 */
export class HoverController {
  private readonly card = new HoverCard({
    onPointerEnter: () => this.cancelClose(),
    onPointerLeave: () => this.scheduleClose(),
  });
  private pending: Pending | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // The card is placed against the underline's viewport position, so it can't follow a page scroll.
    document.addEventListener('scroll', (event) => {
      if (!this.card.contains(event.target)) this.close();
    }, true);
    window.addEventListener('resize', () => this.close());
  }

  /** Hovers `field`'s underlines until `signal` aborts. */
  watch(field: HTMLTextAreaElement, overlay: FieldOverlay, actions: HoverActions, signal: AbortSignal): void {
    const listen = { signal };
    field.addEventListener('mousemove', (event) => this.onHover(field, actions, overlay.errorAt(event.clientX, event.clientY)), listen);
    field.addEventListener('mouseleave', () => this.onHover(field, actions, undefined), listen);
    // Typing (not shortcuts like Ctrl+C or bare modifiers) closes the card.
    field.addEventListener('input', () => this.close(), listen);
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    }, listen);
  }

  private onHover(field: HTMLTextAreaElement, actions: HoverActions, hit: ErrorHit | undefined): void {
    if (!hit) {
      this.cancelPending();
      this.scheduleClose();
      return;
    }
    if (this.card.shownError && sameError(this.card.shownError, hit.error)) {
      this.cancelClose();
      return;
    }
    if (this.pending && sameError(this.pending.error, hit.error)) return;

    // A new underline: restart the delay, so sweeping across text never opens a card.
    this.cancelPending();
    this.pending = {
      error: hit.error,
      timer: setTimeout(() => {
        this.pending = null;
        this.open(field, actions, hit);
      }, OPEN_DELAY_MS),
    };
  }

  private open(field: HTMLTextAreaElement, actions: HoverActions, { error, rect }: ErrorHit): void {
    this.cancelClose();
    const flagged = field.value.slice(error.start, error.end);
    this.card.show(
      {
        error,
        onApply:
          error.kind === 'spelling'
            ? (suggestion) => {
                this.close();
                applySuggestion(field, error, flagged, suggestion);
              }
            : undefined,
        onIgnore: () => {
          this.close();
          actions.ignore(error);
        },
        // A multi-word span (the LLM may quote one) isn't a word to learn.
        onAddToDictionary:
          error.kind === 'spelling' && !/\s/.test(flagged.trim())
            ? () => {
                this.close();
                actions.addToDictionary(flagged);
              }
            : undefined,
      },
      rect,
    );
  }

  close(): void {
    this.cancelPending();
    this.cancelClose();
    this.card.hide();
  }

  private scheduleClose(): void {
    if (!this.card.shownError || this.closeTimer) return;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = undefined;
      this.card.hide();
    }, CLOSE_DELAY_MS);
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

function sameError(a: CheckError, b: CheckError): boolean {
  return a.start === b.start && a.end === b.end && a.id === b.id;
}

/**
 * Replaces the Error's text the way typing would: through the editing command
 * stack, so Ctrl+Z restores the original and the site gets real
 * beforeinput/input events (and keeps the fix on preview or submit).
 */
function applySuggestion(
  field: HTMLTextAreaElement,
  error: CheckError,
  flagged: string,
  suggestion: string,
): void {
  // The text moved on since the card opened; replacing by offset would hit the wrong words.
  if (field.value.slice(error.start, error.end) !== flagged) return;

  field.focus();
  field.setSelectionRange(error.start, error.end);
  if (document.execCommand('insertText', false, suggestion)) return;

  // execCommand is deprecated and may one day be removed; fall back to a plain
  // edit, which the site still sees but which can't be undone with Ctrl+Z.
  field.setRangeText(suggestion, error.start, error.end, 'end');
  field.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: suggestion }),
  );
}
