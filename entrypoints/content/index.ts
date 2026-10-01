import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { FieldOverlay } from './field-overlay';
import { HoverController } from './hover';
import { createFieldChecker, type FieldChecker } from '../../lib/checker';
import { RateLimitedError, type Engine } from '../../lib/engine';
import type { CheckFieldMessage, CheckFieldResponse } from '../../lib/messages';
import { isSiteDisabled } from '../../lib/settings';
import { store } from '../../lib/store';

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
  async main() {
    const hostname = location.hostname;
    let settings = await store.getSettings();
    const site = { hostname, settings: () => settings };

    const hover = new HoverController();
    /** Undoes `start()` while Type Right is running on this page. */
    let stop: (() => void) | null = null;

    /** Attaches to every textarea on the page; returns a function that removes all trace of it. */
    function start(): () => void {
      const fields = new Map<HTMLTextAreaElement, FieldState>();
      const listeners = new AbortController();
      const listen = { signal: listeners.signal };

      function attach(field: HTMLTextAreaElement): void {
        if (fields.has(field)) return;
        const overlay = new FieldOverlay(field);
        const checker = createFieldChecker({
          engines: { languageTool },
          site,
          onChange: (errors) => overlay.render(field.value, errors),
        });
        fields.set(field, { overlay, checker });
        hover.watch(field, overlay, listeners.signal);
        field.addEventListener('input', () => {
          // Render shifted/trimmed underlines on every keystroke; the debounced
          // re-check then fills in anything new.
          overlay.render(field.value, checker.update(field.value));
        }, listen);
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
      document.addEventListener('scroll', repositionAll, { capture: true, signal: listeners.signal });
      window.addEventListener('resize', repositionAll, listen);

      return () => {
        observer.disconnect();
        listeners.abort();
        hover.close();
        fields.forEach(({ overlay, checker }) => {
          checker.dispose();
          overlay.destroy();
        });
      };
    }

    // A disabled site gets no checking and no overlay; toggling it on the
    // Options page takes effect without reloading the page.
    function apply(): void {
      const disabled = isSiteDisabled(hostname, settings);
      if (disabled && stop) {
        stop();
        stop = null;
      } else if (!disabled && !stop) {
        stop = start();
      }
    }

    apply();
    store.watchSettings((next) => {
      settings = next;
      apply();
    });
  },
});
