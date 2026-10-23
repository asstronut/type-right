import type { FieldAdapter, FieldRead } from './field';
import { isHidden } from './hidden';
import { createRichTextReader } from './rich-text';
import type { Slip } from '../../../lib/slips';

export function editingHostOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element) || target instanceof HTMLTextAreaElement) return null;
  let host: HTMLElement | null = null;
  for (let element: Element | null = target; element; element = element.parentElement) {
    if (element instanceof HTMLElement && element.isContentEditable) host = element;
  }
  return host;
}

export function canBeRichField(host: HTMLElement): boolean {
  const role = host.getAttribute('role');
  if (role === 'combobox' || role === 'searchbox') return false;
  if (host.getAttribute('aria-multiline') === 'false') return false;
  if (host.closest('.cm-editor, .monaco-editor, .ace_editor')) return false;
  return !isHidden(host);
}

/** Editors sync their own selection on `selectionchange`; one frame is the longest Apply waits for it. */
function nextSelectionChangeOrFrame(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      document.removeEventListener('selectionchange', done);
      cancelAnimationFrame(frame);
      resolve();
    };
    const frame = requestAnimationFrame(done);
    document.addEventListener('selectionchange', done);
  });
}

export function richEditorAdapter(host: HTMLElement, applyRefused: () => boolean): FieldAdapter {
  const reader = createRichTextReader(host);
  let onRead: ((read: FieldRead) => void) | undefined;
  let composing = false;
  let latest: FieldRead | undefined;
  let observer: MutationObserver | undefined;

  function deliver(changes: readonly MutationRecord[]): FieldRead | undefined {
    if (!onRead) return undefined;
    latest = { ...reader.read(changes), composing };
    onRead(latest);
    return latest;
  }

  /** The Slip's span, when it sits inside one text node of `read`. */
  function inOneTextNode(read: FieldRead, slip: Slip): StaticRange | undefined {
    const range = read.rangeFor(slip);
    const { startContainer, endContainer } = range;
    if (range.collapsed || startContainer !== endContainer || !(startContainer instanceof Text)) return undefined;
    return range as StaticRange;
  }

  return {
    element: host,

    watch(callback, signal) {
      onRead = callback;
      // Every batch is read again even when the text is the same: editors re-render nodes with identical text, which strands the ranges on the old nodes.
      const watching = new MutationObserver(deliver);
      observer = watching;
      host.addEventListener('compositionstart', () => (composing = true), { signal });
      host.addEventListener('compositionend', () => {
        composing = false;
        deliver(watching.takeRecords());
      }, { signal });
      deliver([]);
      watching.observe(host, { childList: true, characterData: true, subtree: true });
      signal.addEventListener('abort', () => watching.disconnect(), { once: true });
    },

    canApply: (slip) => !applyRefused() && host.isContentEditable && latest !== undefined && inOneTextNode(latest, slip) !== undefined,

    async replace(slip, flagged, suggestion) {
      const read = deliver(observer?.takeRecords() ?? []);
      const range = read && host.isContentEditable && read.text.slice(slip.start, slip.end) === flagged ? inOneTextNode(read, slip) : undefined;
      if (!range) return 'stale';

      host.focus({ preventScroll: true });
      const live = document.createRange();
      live.setStart(range.startContainer, range.startOffset);
      live.setEnd(range.endContainer, range.endOffset);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(live);
      await nextSelectionChangeOrFrame();

      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', suggestion);
      const unclaimed = host.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertReplacementText',
          data: suggestion,
          dataTransfer,
          targetRanges: [range],
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
      if (unclaimed && !host.matches('[data-slate-editor]')) {
        const fresh = deliver(observer?.takeRecords() ?? []);
        if (fresh?.text.slice(slip.start, slip.end) === flagged) document.execCommand('insertText', false, suggestion);
      }
      return 'attempted';
    },
  };
}
