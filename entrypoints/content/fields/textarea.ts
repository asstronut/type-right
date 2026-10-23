import type { FieldAdapter, FieldRead } from './field';
import { isHidden } from './hidden';

export function textareaAdapter(textarea: HTMLTextAreaElement): FieldAdapter {
  function read(composing: boolean): FieldRead {
    const text = textarea.value;
    return {
      text,
      neverFlag: [],
      composing,
      // A site may set the value by script without an `input` event; offsets into the old text would underline the wrong words.
      rangeFor: (span) => (textarea.value === text ? textarea.createValueRange(span.start, span.end) : textarea.createValueRange(0, 0)),
    };
  }

  return {
    element: textarea,

    watch(onRead, signal) {
      let delivered = false;
      function deliver(composing: boolean): void {
        delivered = true;
        onRead(read(composing));
      }
      function deliverPrefilled(): void {
        if (!delivered && textarea.value && someoneCanType(textarea)) deliver(false);
      }
      textarea.addEventListener('input', (event) => deliver(event instanceof InputEvent && event.isComposing), { signal });
      textarea.addEventListener('compositionend', () => deliver(false), { signal });
      textarea.addEventListener('focus', deliverPrefilled, { signal });
      deliverPrefilled();
    },

    canApply: () => true,

    /**
     * Replaces the Slip's text the way typing would: through the editing command
     * stack, so Ctrl+Z restores the original and the site gets real
     * beforeinput/input events (and keeps the fix on preview or submit).
     */
    async replace(slip, flagged, suggestion) {
      if (textarea.value.slice(slip.start, slip.end) !== flagged) return;
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
