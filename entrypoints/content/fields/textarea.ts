import type { FieldAdapter, FieldRead } from './field';
import { isHidden } from './hidden';

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
      if (textarea.value && someoneCanType(textarea)) onRead(read(false));
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

      textarea.setRangeText(suggestion, slip.start, slip.end, 'end');
      textarea.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: suggestion }),
      );
    },
  };
}

function someoneCanType(textarea: HTMLTextAreaElement): boolean {
  return !textarea.disabled && !textarea.readOnly && !isHidden(textarea);
}
