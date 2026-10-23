import type { FieldAdapter, FieldRead } from './field';
import { isHidden } from './hidden';

/** The Field adapter for a `<textarea>`. */
export function textareaAdapter(textarea: HTMLTextAreaElement): FieldAdapter {
  function read(composing: boolean): FieldRead {
    return {
      text: textarea.value,
      neverFlag: [],
      composing,
      // A site may clear the textarea by script without an `input` event, so a read can outlive its text.
      rangeFor: (span) => {
        const length = textarea.value.length;
        return textarea.createValueRange(Math.min(span.start, length), Math.min(span.end, length));
      },
    };
  }

  return {
    element: textarea,

    watch(onRead, signal) {
      textarea.addEventListener('input', (event) => onRead(read(event instanceof InputEvent && event.isComposing)), { signal });
      // Pre-filled fields (e.g. edit forms) get checked once without waiting for a keystroke,
      // unless nobody is typing in them: a disabled, read-only or hidden one waits for its first input.
      if (textarea.value && !textarea.disabled && !textarea.readOnly && !isHidden(textarea)) onRead(read(false));
    },

    canApply: () => true,

    /**
     * Replaces the Slip's text the way typing would: through the editing command
     * stack, so Ctrl+Z restores the original and the site gets real
     * beforeinput/input events (and keeps the fix on preview or submit).
     */
    async replace(slip, suggestion) {
      textarea.focus();
      textarea.setSelectionRange(slip.start, slip.end);
      if (document.execCommand('insertText', false, suggestion)) return;

      // execCommand is deprecated and may one day be removed; fall back to a plain
      // edit, which the site still sees but which can't be undone with Ctrl+Z.
      textarea.setRangeText(suggestion, slip.start, slip.end, 'end');
      textarea.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: suggestion }),
      );
    },
  };
}
