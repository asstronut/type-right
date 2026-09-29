import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { FieldOverlay } from './field-overlay';
import type { CheckFieldMessage, CheckFieldResponse } from '../../lib/messages';

const CHECK_DEBOUNCE_MS = 600;

interface FieldState {
  overlay: FieldOverlay;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    const fields = new Map<HTMLTextAreaElement, FieldState>();

    function attach(field: HTMLTextAreaElement): void {
      if (fields.has(field)) return;
      fields.set(field, { overlay: new FieldOverlay(field), timer: undefined });
      field.addEventListener('input', () => scheduleCheck(field));
    }

    function scheduleCheck(field: HTMLTextAreaElement): void {
      const state = fields.get(field);
      if (!state) return;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => void runCheck(field), CHECK_DEBOUNCE_MS);
    }

    async function runCheck(field: HTMLTextAreaElement): Promise<void> {
      const state = fields.get(field);
      if (!state) return;
      const { overlay } = state;

      const text = field.value;
      if (!text.trim()) {
        overlay.clear();
        return;
      }

      const message: CheckFieldMessage = { type: 'check-field', text };
      const response = (await browser.runtime.sendMessage(message)) as
        | CheckFieldResponse
        | undefined;
      if (!response) return;
      overlay.render(text, response.errors);
    }

    function attachAllWithin(root: ParentNode): void {
      root.querySelectorAll('textarea').forEach((field) => attach(field as HTMLTextAreaElement));
    }

    attachAllWithin(document);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node instanceof HTMLTextAreaElement) attach(node);
          attachAllWithin(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Reposition (not re-render) on page scroll/resize; the field's own
    // scroll is handled inside FieldOverlay itself.
    const repositionAll = () => fields.forEach(({ overlay }) => overlay.reposition());
    document.addEventListener('scroll', repositionAll, true);
    window.addEventListener('resize', repositionAll);
  },
});
