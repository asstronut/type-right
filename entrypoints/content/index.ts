import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { FieldOverlay } from './field-overlay';
import { createFieldChecker, type FieldChecker } from '../../lib/checker';
import { RateLimitedError, type Engine } from '../../lib/engine';
import type { CheckFieldMessage, CheckFieldResponse } from '../../lib/messages';

/** Runs LanguageTool in the background worker, via message, as a plain Engine. */
const languageTool: Engine = {
  async check(text) {
    const message: CheckFieldMessage = { type: 'check-field', text };
    const response = (await browser.runtime.sendMessage(message)) as CheckFieldResponse | undefined;
    if (response?.ok) return response.errors;
    if (response && response.reason === 'rate-limited') throw new RateLimitedError(response.retryAfterMs);
    throw new Error('LanguageTool check failed');
  },
};

interface FieldState {
  overlay: FieldOverlay;
  checker: FieldChecker;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    const fields = new Map<HTMLTextAreaElement, FieldState>();

    function attach(field: HTMLTextAreaElement): void {
      if (fields.has(field)) return;
      const overlay = new FieldOverlay(field);
      const checker = createFieldChecker({
        engines: { languageTool },
        onChange: (errors) => overlay.render(field.value, errors),
      });
      fields.set(field, { overlay, checker });
      field.addEventListener('input', () => {
        // Render shifted/trimmed underlines on every keystroke; the debounced
        // re-check then fills in anything new.
        overlay.render(field.value, checker.update(field.value));
      });
      // Pre-filled fields (e.g. edit forms) get checked once without waiting for a keystroke.
      if (field.value) overlay.render(field.value, checker.update(field.value));
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
