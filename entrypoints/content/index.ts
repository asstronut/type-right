import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { runPage } from './page';
import { LlmFailedError, RateLimitedError, type Engine } from '../../lib/engine';
import type { LlmFailureLink } from '../../lib/llm-health';
import type {
  CheckMessage,
  CheckResponse,
  LlmFailureMessage,
  LlmFailureQuery,
  LlmFailureResponse,
  TallyMessage,
} from '../../lib/messages';
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

/** The background worker's LLM gate, asked and listened to by message. */
const backgroundLlmFailure: LlmFailureLink = {
  async currentFailure() {
    const query: LlmFailureQuery = { type: 'get-llm-failure' };
    const failure = (await browser.runtime.sendMessage(query)) as LlmFailureResponse | undefined;
    return failure ?? undefined;
  },
  onFailureChange(onChange) {
    const listener = (message: LlmFailureMessage) => {
      if (message?.type === 'llm-failure') onChange(message.failure ?? undefined);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  },
};

export default defineContentScript({
  matches: ['<all_urls>'],
  async main(ctx) {
    // A script injected into a frozen tab runs when the tab wakes, which may be after the extension reloaded again.
    if (ctx.isInvalid) return;
    runPage({
      ctx,
      hostname: location.hostname,
      settings: await store.getSettings(),
      store,
      engines: {
        languageTool: backgroundEngine('check-field', 'LanguageTool'),
        llm: backgroundEngine('check-sentence', 'LLM'),
      },
      llmFailure: backgroundLlmFailure,
      async recordSlips(sightings) {
        const message: TallyMessage = { type: 'record-slips', sightings };
        await browser.runtime.sendMessage(message);
      },
    });
  },
});
