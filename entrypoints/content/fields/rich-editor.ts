import type { FieldAdapter } from './field';
import { isHidden } from './hidden';
import { createRichTextReader } from './rich-text';

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

export function richEditorAdapter(host: HTMLElement): FieldAdapter {
  const reader = createRichTextReader(host);

  return {
    element: host,

    watch(onRead, signal) {
      const deliver = () => onRead({ ...reader.read(), composing: false });
      deliver();
      // Every batch is read again even when the text is the same: editors re-render nodes with identical text, which strands the ranges on the old nodes.
      const observer = new MutationObserver(deliver);
      observer.observe(host, { childList: true, characterData: true, subtree: true });
      signal.addEventListener('abort', () => observer.disconnect(), { once: true });
    },

    canApply: () => false,

    replace: () => Promise.resolve(),
  };
}
