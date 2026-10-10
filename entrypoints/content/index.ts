import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { FieldOverlay } from './field-overlay';
import { HoverController } from './hover';
import { createFieldChecker, type FieldChecker } from '../../lib/checker';
import { LlmFailedError, RateLimitedError, type Engine } from '../../lib/engine';
import { createSharedLlmFailure } from '../../lib/llm-failure';
import type {
  CheckMessage,
  CheckResponse,
  LlmFailureMessage,
  LlmFailureQuery,
  LlmFailureResponse,
  TallyMessage,
} from '../../lib/messages';
import { isSiteDisabled } from '../../lib/settings';
import { store } from '../../lib/store';

/** Runs an engine in the background worker, via message, as a plain Engine. */
function backgroundEngine(type: CheckMessage['type'], name: string): Engine {
  return {
    async check(text) {
      const message: CheckMessage = { type, text };
      const response = (await browser.runtime.sendMessage(message)) as CheckResponse | undefined;
      if (response?.ok) return response.slips;
      if (response?.reason === 'rate-limited') throw new RateLimitedError(response.retryAfterMs);
      if (response?.reason === 'llm-failed') throw new LlmFailedError(response.failure, response.retryAfterMs);
      throw new Error(`${name} check failed`);
    },
  };
}

const engines = {
  languageTool: backgroundEngine('check-field', 'LanguageTool'),
  llm: backgroundEngine('check-sentence', 'LLM'),
};

interface FieldState {
  overlay: FieldOverlay;
  checker: FieldChecker;
}

interface Running {
  /** Removes all trace of Type Right from the page. */
  stop(): void;
  /** Re-reads every field's LLM health and Slips, after a Settings change (e.g. the dictionary). */
  refreshFields(): void;
  /** Lets every field count its Slips again, after the counts are reset. */
  forgetReported(): void;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    const hostname = location.hostname;
    let settings = await store.getSettings();
    const site = { hostname, settings: () => settings };

    // One LLM failure for every field on the page, kept in step with the
    // background worker so a failure in any tab turns every badge red.
    const llmFailure = createSharedLlmFailure();
    /** Set once a broadcast arrives, which is newer than the answer to the start-up query. */
    let heardBroadcast = false;
    browser.runtime.onMessage.addListener((message: LlmFailureMessage) => {
      if (message?.type !== 'llm-failure') return;
      heardBroadcast = true;
      llmFailure.set(message.failure ?? undefined);
    });
    const query: LlmFailureQuery = { type: 'get-llm-failure' };
    void browser.runtime.sendMessage(query).then(
      (failure: LlmFailureResponse | undefined) => {
        if (!heardBroadcast) llmFailure.set(failure ?? undefined);
      },
      () => {},
    );

    const hover = new HoverController();
    /** Set while Type Right is running on this page. */
    let running: Running | null = null;

    /** Attaches to every textarea on the page. */
    function start(): Running {
      const fields = new Map<HTMLTextAreaElement, FieldState>();
      const listeners = new AbortController();
      const listen = { signal: listeners.signal };

      function attach(field: HTMLTextAreaElement): void {
        if (fields.has(field)) return;
        const overlay = new FieldOverlay(field);
        const checker = createFieldChecker({
          engines,
          site,
          llmFailure,
          onChange: (slips) => overlay.render(field.value, slips),
          onLlmHealthChange: (health) => overlay.setLlmHealth(health),
          onSlipsSeen: (sightings) => {
            const message: TallyMessage = { type: 'record-slips', sightings };
            void browser.runtime.sendMessage(message).catch(() => {});
          },
        });
        overlay.setLlmHealth(checker.llmHealth());
        fields.set(field, { overlay, checker });
        hover.watch(field, overlay, {
          ignore: (slip) => checker.ignore(slip.id),
          // Saving notifies every tab's watcher, which re-renders all fields without the word.
          addToDictionary: (word) => void store.addToDictionary(word),
        }, listeners.signal);
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

      return {
        stop() {
          observer.disconnect();
          listeners.abort();
          hover.close();
          fields.forEach(({ overlay, checker }) => {
            checker.dispose();
            overlay.destroy();
          });
        },
        refreshFields() {
          fields.forEach(({ overlay, checker }, field) => {
            overlay.setLlmHealth(checker.llmHealth());
            overlay.render(field.value, checker.slips());
          });
        },
        forgetReported() {
          fields.forEach(({ checker }) => checker.forgetReported());
        },
      };
    }

    // A disabled site gets no checking and no overlay; toggling it on the
    // Options page takes effect without reloading the page.
    function apply(): void {
      const disabled = isSiteDisabled(hostname, settings);
      if (disabled && running) {
        running.stop();
        running = null;
      } else if (!disabled && !running) {
        running = start();
      }
    }

    apply();
    store.watchSettings((next) => {
      settings = next;
      apply();
      // Consent, the key or the site lists may have changed what the LLM badge
      // should say, and the dictionary which Slips to show.
      running?.refreshFields();
    });
    // Only a reset empties the tally; Slips still on screen count again on their field's next check.
    store.watchTally((tally) => {
      if (!tally.seen.length) running?.forgetReported();
    });
  },
});
