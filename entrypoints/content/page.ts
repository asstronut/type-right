import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createField, type Field, type FieldDeps } from './fields/field';
import { textareaAdapter } from './fields/textarea';
import { HoverController } from './hover';
import { createUnderlines } from './underlines';
import type { CheckEngines } from '../../lib/checker';
import type { Engine } from '../../lib/engine';
import { createLlmHealth, type LlmFailureLink, type LlmHealth } from '../../lib/llm-health';
import { isSiteDisabled, type Settings } from '../../lib/settings';
import type { SlipSighting, SlipTally } from '../../lib/slip-tally';

/** The parts of the extension's storage the page uses. */
export interface PageStore {
  /** Calls `onChange` with the new Settings after every change; returns a function that stops it. */
  watchSettings(onChange: (settings: Settings) => void): () => void;
  /** Calls `onChange` with the new Tally after every change; returns a function that stops it. */
  watchTally(onChange: (tally: SlipTally) => void): () => void;
  addToDictionary(word: string): Promise<unknown>;
}

export interface PageOptions {
  /** The content script's context: once it is invalidated, Type Right leaves the page. */
  ctx: ContentScriptContext;
  hostname: string;
  /** The Settings when the page started; `store` tells of later ones. */
  settings: Settings;
  store: PageStore;
  /** The Engines, which run in the background worker. */
  engines: CheckEngines;
  /** The way to the background worker's LLM gate. */
  llmFailure: LlmFailureLink;
  /** Has the background worker count newly seen Slips in the Tally. */
  recordSlips(sightings: SlipSighting[]): Promise<void>;
}

interface Running {
  /** Removes all trace of Type Right from the page. */
  stop(): void;
  /** Shows the page's LLM health on every Field's LLM badge. */
  showLlmHealth(health: LlmHealth): void;
  /** Re-renders every Field's Slips, after a Settings change (e.g. the Dictionary). */
  refreshFields(): void;
  /** Lets every Field count its Slips again, after the counts are reset. */
  forgetReported(): void;
}

/**
 * Runs Type Right on the page: attaches to every textarea while the site is
 * on, and leaves the page entirely once the extension reloads, updates or is
 * removed, since the page can no longer reach the background worker then.
 */
export function runPage(options: PageOptions): void {
  const { ctx, hostname, store } = options;

  /**
   * Whether the extension has reloaded since the page started. Chrome doesn't
   * tell an orphaned content script, and WXT only finds out when asked, so
   * asking is what runs the teardown below.
   */
  const noticeReload = () => ctx.isInvalid;
  if (noticeReload()) return;

  /**
   * Subscribes `onChange` until Type Right leaves the page. Once it has, an
   * extension API may throw on unsubscribing, and the subscription it couldn't
   * end must not reach the page or the worker.
   */
  function untilGone<T>(
    subscribe: (onChange: (value: T) => void) => () => void,
    onChange: (value: T) => void,
  ): () => void {
    const stop = subscribe((value) => {
      if (!ctx.signal.aborted) onChange(value);
    });
    return () => {
      try {
        stop();
      } catch {
        // The extension is gone, and its listeners with it.
      }
    };
  }

  let settings = options.settings;
  const site = { hostname, settings: () => settings };
  const engines = {
    languageTool: noticingFailure(options.engines.languageTool, noticeReload),
    llm: options.engines.llm && noticingFailure(options.engines.llm, noticeReload),
  };

  // One LLM health for every Field on the page, kept in step with Settings and
  // the background worker, so a failure in any tab turns every badge red. It
  // keeps running while the site is turned off and on.
  const llmHealth = createLlmHealth({
    hostname,
    settings: {
      get: () => settings,
      watch: (onChange) => untilGone((watcher) => store.watchSettings(watcher), onChange),
    },
    link: {
      currentFailure: () => options.llmFailure.currentFailure(),
      onFailureChange: (onChange) => untilGone((watcher) => options.llmFailure.onFailureChange(watcher), onChange),
    },
  });

  const hover = new HoverController();
  /** Set while Type Right is running on this page. */
  let running: Running | null = null;

  /** Attaches to every textarea on the page. */
  function start(): Running {
    const fields = new Map<HTMLElement, Field>();
    const underlines = createUnderlines();
    const deps: FieldDeps = {
      engines,
      site,
      llmHealth,
      underlines,
      hover,
      addToDictionary: (word) => void store.addToDictionary(word),
      onSlipsSeen: (sightings) => {
        void options.recordSlips(sightings).catch(noticeReload);
      },
      noticeReload,
    };

    function attach(textarea: HTMLTextAreaElement): void {
      if (fields.has(textarea)) return;
      fields.set(textarea, createField(textareaAdapter(textarea), deps));
    }

    function attachAllWithin(root: ParentNode): void {
      root.querySelectorAll('textarea').forEach(attach);
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
      for (const [element, field] of fields) {
        if (element.isConnected) continue;
        field.dispose();
        fields.delete(element);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    return {
      stop() {
        observer.disconnect();
        fields.forEach((field) => field.dispose());
        underlines.dispose();
      },
      showLlmHealth(health) {
        fields.forEach((field) => field.showLlmHealth(health));
      },
      refreshFields() {
        fields.forEach((field) => field.refresh());
      },
      forgetReported() {
        fields.forEach((field) => field.forgetReported());
      },
    };
  }

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
  const stopShowingHealth = untilGone<LlmHealth>(
    (watcher) => llmHealth.watch(watcher),
    (health) => running?.showLlmHealth(health),
  );
  const stopWatchingSettings = untilGone<Settings>((watcher) => store.watchSettings(watcher), (next) => {
    settings = next;
    apply();
    // The dictionary may have changed which Slips to show.
    running?.refreshFields();
  });
  // Only a reset empties the tally; Slips still on screen count again on their field's next check.
  const stopWatchingTally = untilGone<SlipTally>((watcher) => store.watchTally(watcher), (tally) => {
    if (!tally.seen.length) running?.forgetReported();
  });

  // Each step runs even if one before it throws, as extension APIs may once the extension is gone;
  // the page's own cleanup goes first.
  ctx.onInvalidated(() => {
    for (const step of [
      () => {
        running?.stop();
        running = null;
      },
      () => hover.destroy(),
      () => llmHealth.dispose(),
      stopShowingHealth,
      stopWatchingSettings,
      stopWatchingTally,
    ]) {
      try {
        step();
      } catch {
        // Nothing left to tell: the extension is gone.
      }
    }
  });
}

/** `engine`, which on a failed check asks whether the extension is gone, as that's how a reload first shows. */
function noticingFailure(engine: Engine, noticeReload: () => boolean): Engine {
  return {
    async check(text) {
      try {
        return await engine.check(text);
      } catch (error) {
        noticeReload();
        throw error;
      }
    },
  };
}
