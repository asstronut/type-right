import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmFailure } from './engine';
import { createLlmHealth, type LlmFailureLink, type LlmHealth } from './llm-health';
import { createTestLlmWiring, type TestLlmWiring } from './llm-test-wiring';
import type { Settings } from './settings';

const allowed: Partial<Settings> = { llmProvider: 'glm', llmConsent: true, llmApiKey: 'test-key' };

function chatCompletion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200 });
}

/** How each Provider says its key is rate-limited. */
const RATE_LIMITED = {
  glm: () => new Response(JSON.stringify({ error: { code: '1302', message: 'Rate limit reached' } }), { status: 429 }),
  gemini: () =>
    new Response(JSON.stringify([{ error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED' } }]), {
      status: 429,
    }),
};

describe('createLlmHealth', () => {
  const fetchMock = vi.fn();
  /** Raw LLM responses to return (or throw), in order, before falling back to a reply with no Slips. */
  let responses: ((init: { signal?: AbortSignal }) => Response | Promise<Response>)[];

  /** One LLM check through the worker's gate, as a Field's would be; resolves once the pages have heard the outcome. */
  async function check(wiring: TestLlmWiring, text = 'I am agree.'): Promise<void> {
    await wiring.gate.check(text, wiring.settings()).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    responses = [];
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (_url: string, init: { signal?: AbortSignal }) => {
      return responses.shift()?.(init) ?? chatCompletion('{"errors":[]}');
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  describe('from Settings', () => {
    it('is active when the LLM is allowed', () => {
      const page = createTestLlmWiring(allowed).openPage('github.com');

      expect(page.health()).toEqual({ state: 'active' });
      expect(page.mayCheck()).toEqual({ allowed: true });
    });

    it('is LT only without consent', () => {
      const page = createTestLlmWiring({ ...allowed, llmConsent: false }).openPage('github.com');

      expect(page.health()).toEqual({ state: 'lt-only', reason: 'no-consent' });
      expect(page.mayCheck()).toEqual({ allowed: false, reason: 'no-consent' });
    });

    it('is LT only on an excluded site and its subdomains', () => {
      const wiring = createTestLlmWiring({ ...allowed, excludedSites: ['example.com'] });

      for (const hostname of ['example.com', 'mail.example.com']) {
        const page = wiring.openPage(hostname);
        expect(page.health()).toEqual({ state: 'lt-only', reason: 'excluded-site' });
        expect(page.mayCheck()).toEqual({ allowed: false, reason: 'excluded-site' });
      }
      expect(wiring.openPage('github.com').health()).toEqual({ state: 'active' });
    });

    it('is failing with no key when consent is given but no key is set', () => {
      const page = createTestLlmWiring({ ...allowed, llmApiKey: '' }).openPage('github.com');

      expect(page.health()).toEqual({ state: 'failing', reason: 'no-key' });
      expect(page.mayCheck()).toEqual({ allowed: false, reason: 'no-key' });
    });

    it.each([
      ['active', allowed, { state: 'active' }],
      ['LT only without consent', { ...allowed, llmConsent: false }, { state: 'lt-only', reason: 'no-consent' }],
      ['failing with no key', { ...allowed, llmApiKey: '' }, { state: 'failing', reason: 'no-key' }],
    ] as const)(
      'on a disabled site still reports what the page would get with Type Right on: %s',
      (_, settings, health) => {
        const page = createTestLlmWiring({ ...settings, disabledSites: ['example.com'] }).openPage('example.com');

        expect(page.health()).toEqual(health);
      },
    );

    it('may not send from a disabled site, whatever its health', () => {
      const page = createTestLlmWiring({ ...allowed, disabledSites: ['example.com'] }).openPage('example.com');

      expect(page.mayCheck()).toEqual({ allowed: false, reason: 'disabled-site' });
    });
  });

  describe('from the worker', () => {
    it.each([
      ['no-key', 'the key is rejected (401)', 'glm', () => new Response('{}', { status: 401 })],
      ['no-key', 'the key is forbidden (403)', 'glm', () => new Response('{}', { status: 403 })],
      ['quota', 'the key is rate-limited (429) by GLM', 'glm', RATE_LIMITED.glm],
      ['quota', 'the key is rate-limited (429) by Gemini', 'gemini', RATE_LIMITED.gemini],
      ['bad-response', 'the server errors (500)', 'glm', () => new Response('oops', { status: 500 })],
      ['bad-response', 'the body is not a chat completion', 'glm', () => new Response('<html>', { status: 200 })],
      [
        'network',
        'the request cannot reach the server',
        'glm',
        () => {
          throw new TypeError('Failed to fetch');
        },
      ],
    ] as const)('turns failing with %s when %s', async (reason, _, llmProvider, response) => {
      const wiring = createTestLlmWiring({ ...allowed, llmProvider });
      const page = wiring.openPage('github.com');
      responses.push(response);

      await check(wiring);

      expect(page.health()).toEqual({ state: 'failing', reason });
    });

    it('may still send while failing with a rejected key, so the gate can turn the check away; with no key at all it may not', async () => {
      const wiring = createTestLlmWiring(allowed);
      const page = wiring.openPage('github.com');
      responses.push(() => new Response('{}', { status: 401 }));
      await check(wiring);
      expect(page.health()).toEqual({ state: 'failing', reason: 'no-key' });
      expect(page.mayCheck()).toEqual({ allowed: true });

      wiring.changeSettings({ llmApiKey: '' });
      expect(page.health()).toEqual({ state: 'failing', reason: 'no-key' });
      expect(page.mayCheck()).toEqual({ allowed: false, reason: 'no-key' });
    });

    it('turns failing with timeout once the LLM has taken longer than 8s', async () => {
      const wiring = createTestLlmWiring(allowed);
      const page = wiring.openPage('github.com');
      responses.push(
        ({ signal }) =>
          new Promise((_, reject) =>
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
          ),
      );

      void wiring.gate.check('I am agree.', wiring.settings()).catch(() => {});
      await vi.advanceTimersByTimeAsync(7_900);
      expect(page.health()).toEqual({ state: 'active' });

      await vi.advanceTimersByTimeAsync(200);
      expect(page.health()).toEqual({ state: 'failing', reason: 'timeout' });
    });

    it('stays failing through the 60s pause, then turns active after the next success', async () => {
      const wiring = createTestLlmWiring(allowed);
      const page = wiring.openPage('github.com');
      responses.push(() => new Response('oops', { status: 500 }));
      await check(wiring);

      await vi.advanceTimersByTimeAsync(55_000);
      await check(wiring, 'Another sentence.');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(page.health()).toEqual({ state: 'failing', reason: 'bad-response' });

      await vi.advanceTimersByTimeAsync(5_000);
      await check(wiring);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(page.health()).toEqual({ state: 'active' });
    });

    it('tells every page, so one failure turns them all failing and the next success all active', async () => {
      const wiring = createTestLlmWiring(allowed);
      const pages = [wiring.openPage('github.com'), wiring.openPage('example.org')];
      responses.push(() => new Response('oops', { status: 500 }));

      await check(wiring);
      expect(pages.map((page) => page.health())).toEqual([
        { state: 'failing', reason: 'bad-response' },
        { state: 'failing', reason: 'bad-response' },
      ]);

      await vi.advanceTimersByTimeAsync(60_000);
      await check(wiring);
      expect(pages.map((page) => page.health())).toEqual([{ state: 'active' }, { state: 'active' }]);
    });
  });

  describe('when the page opens', () => {
    it('learns of a failure the worker already has', async () => {
      const wiring = createTestLlmWiring(allowed);
      responses.push(() => new Response('oops', { status: 500 }));
      await check(wiring);

      const page = wiring.openPage('github.com');
      await vi.advanceTimersByTimeAsync(0);

      expect(page.health()).toEqual({ state: 'failing', reason: 'bad-response' });
    });

    it('trusts an announcement that arrives before the answer it asked for', async () => {
      const wiring = createTestLlmWiring(allowed);
      /** The worker answers at once, but the answer reaches the page only when released. */
      let release!: () => void;
      const delivered = new Promise<void>((resolve) => (release = resolve));
      const link: LlmFailureLink = {
        ...wiring.link,
        currentFailure: async () => {
          const answer = await wiring.link.currentFailure();
          await delivered;
          return answer;
        },
      };
      const page = createLlmHealth({ hostname: 'github.com', settings: wiring.settingsSource, link });
      responses.push(() => new Response('oops', { status: 500 }));

      await check(wiring);
      release();
      await vi.advanceTimersByTimeAsync(0);

      // The answer said the LLM was fine, which was true before the failure.
      expect(page.health()).toEqual({ state: 'failing', reason: 'bad-response' });
    });
  });

  describe('when Settings change', () => {
    it('follows them at once: LT only when consent is withdrawn, active when it is given again', () => {
      const wiring = createTestLlmWiring(allowed);
      const page = wiring.openPage('github.com');

      wiring.changeSettings({ llmConsent: false });
      expect(page.health()).toEqual({ state: 'lt-only', reason: 'no-consent' });
      expect(page.mayCheck()).toEqual({ allowed: false, reason: 'no-consent' });

      wiring.changeSettings({ llmConsent: true });
      expect(page.health()).toEqual({ state: 'active' });
      expect(page.mayCheck()).toEqual({ allowed: true });
    });

    it('follows the site lists too', () => {
      const wiring = createTestLlmWiring(allowed);
      const page = wiring.openPage('mail.example.com');

      wiring.changeSettings({ excludedSites: ['example.com'] });
      expect(page.health()).toEqual({ state: 'lt-only', reason: 'excluded-site' });

      wiring.changeSettings({ excludedSites: [], disabledSites: ['example.com'] });
      expect(page.health()).toEqual({ state: 'active' });
      expect(page.mayCheck()).toEqual({ allowed: false, reason: 'disabled-site' });
    });

    it.each([
      ['key', { llmApiKey: 'new-key' }],
      ['Provider', { llmProvider: 'gemini' }],
    ] as const)('asks the worker again, so a failure made with the old %s is forgotten', async (_, change) => {
      const wiring = createTestLlmWiring(allowed);
      const page = wiring.openPage('github.com');
      responses.push(() => new Response('{}', { status: 401 }));
      await check(wiring);
      expect(page.health()).toEqual({ state: 'failing', reason: 'no-key' });

      wiring.changeSettings(change);
      await vi.advanceTimersByTimeAsync(0);

      expect(page.health()).toEqual({ state: 'active' });
    });

    it('uses the answer to the latest question when the answers arrive out of order', async () => {
      const wiring = createTestLlmWiring(allowed);
      const answers: ((failure: LlmFailure | undefined) => void)[] = [];
      const link: LlmFailureLink = {
        ...wiring.link,
        currentFailure: () => new Promise((resolve) => answers.push(resolve)),
      };
      const page = createLlmHealth({ hostname: 'github.com', settings: wiring.settingsSource, link });
      wiring.changeSettings({ llmApiKey: 'new-key' });

      answers[1]!(undefined);
      answers[0]!('quota');
      await vi.advanceTimersByTimeAsync(0);

      expect(page.health()).toEqual({ state: 'active' });
    });

    it('keeps a failure the worker still has after a change that is not about the LLM', async () => {
      const wiring = createTestLlmWiring(allowed);
      const page = wiring.openPage('github.com');
      responses.push(() => new Response('oops', { status: 500 }));
      await check(wiring);

      wiring.changeSettings({ dictionary: ['Akbar'] });
      await vi.advanceTimersByTimeAsync(0);

      expect(page.health()).toEqual({ state: 'failing', reason: 'bad-response' });
    });
  });

  describe('watching', () => {
    it('tells a watcher each time the health changes, whatever changed it', async () => {
      const wiring = createTestLlmWiring(allowed);
      const page = wiring.openPage('github.com');
      const seen: LlmHealth[] = [];
      page.watch((health) => seen.push(health));

      wiring.changeSettings({ llmConsent: false });
      wiring.changeSettings({ llmConsent: true });
      responses.push(() => new Response('oops', { status: 500 }));
      await check(wiring);
      await vi.advanceTimersByTimeAsync(60_000);
      await check(wiring);

      expect(seen).toEqual([
        { state: 'lt-only', reason: 'no-consent' },
        { state: 'active' },
        { state: 'failing', reason: 'bad-response' },
        { state: 'active' },
      ]);
    });

    it('tells a watcher what the answer to the start-up question brings', async () => {
      const wiring = createTestLlmWiring(allowed);
      responses.push(() => new Response('oops', { status: 500 }));
      await check(wiring);
      const page = wiring.openPage('github.com');
      const seen: LlmHealth[] = [];
      page.watch((health) => seen.push(health));

      await vi.advanceTimersByTimeAsync(0);

      expect(seen).toEqual([{ state: 'failing', reason: 'bad-response' }]);
    });

    it('stays quiet while the health stays the same', async () => {
      const wiring = createTestLlmWiring(allowed);
      const page = wiring.openPage('github.com');
      const seen: LlmHealth[] = [];
      page.watch((health) => seen.push(health));

      wiring.changeSettings({ dictionary: ['Akbar'] });
      wiring.changeSettings({ englishVariant: 'en-GB' });
      await vi.advanceTimersByTimeAsync(0);

      expect(seen).toEqual([]);
    });

    it('stops telling a watcher that has stopped', () => {
      const wiring = createTestLlmWiring(allowed);
      const page = wiring.openPage('github.com');
      const seen: LlmHealth[] = [];
      const stop = page.watch((health) => seen.push(health));

      stop();
      wiring.changeSettings({ llmConsent: false });

      expect(seen).toEqual([]);
    });
  });
});
