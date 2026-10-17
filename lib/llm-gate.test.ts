import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmFailedError } from './engine';
import { createLlmEngine } from './engines/llm';
import { createLlmGate } from './llm-gate';
import { DEFAULT_SETTINGS, type Settings } from './settings';

const GLM_URL = 'https://api.z.ai/api/paas/v4/chat/completions';
const settings: Settings = { ...DEFAULT_SETTINGS, llmProvider: 'glm', llmApiKey: 'test-key', llmConsent: true };

function chatCompletion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200 });
}

describe('createLlmGate', () => {
  const fetchMock = vi.fn();
  /** Raw LLM responses to return, in order, before falling back to a reply with no Slips. */
  let responses: (() => Response)[];

  function setup() {
    return createLlmGate({ engine: (s) => createLlmEngine(s.llmProvider, s.llmApiKey, s.mixedInLanguage), settings: async () => settings });
  }

  /** The failure a check throws, or undefined when it succeeds. */
  async function failureOf(check: Promise<unknown>): Promise<unknown> {
    try {
      await check;
      return undefined;
    } catch (error) {
      return error instanceof LlmFailedError ? error.failure : error;
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    responses = [];
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async () => responses.shift()?.() ?? chatCompletion('{"errors":[]}'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('refuses every check for 60s after a failure, with its reason, without asking the Provider', async () => {
    const gate = setup();
    responses.push(() => new Response('{}', { status: 401 }));
    expect(await failureOf(gate.check('I am agree.', settings))).toBe('no-key');

    await vi.advanceTimersByTimeAsync(59_000);
    expect(await failureOf(gate.check('Another sentence.', settings))).toBe('no-key');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says how much of the pause is left when it refuses a check', async () => {
    const gate = setup();
    responses.push(() => new Response('{}', { status: 401 }));
    const failed = await gate.check('I am agree.', settings).catch((error) => error);
    expect(failed).toMatchObject({ failure: 'no-key', retryAfterMs: 60_000 });

    await vi.advanceTimersByTimeAsync(45_000);
    const refused = await gate.check('Another sentence.', settings).catch((error) => error);

    expect(refused).toMatchObject({ failure: 'no-key', retryAfterMs: 15_000 });
  });

  it('keeps the failure and its pause across a worker restart, and announces the recovery', async () => {
    let saved: unknown;
    const storage = {
      get: async () => saved as never,
      set: async (value: unknown) => {
        saved = value;
      },
    };
    const engine = (s: Settings) => createLlmEngine(s.llmProvider, s.llmApiKey, s.mixedInLanguage);
    const current = async () => settings;
    responses.push(() => new Response('{}', { status: 401 }));
    await failureOf(createLlmGate({ engine, settings: current, storage }).check('I am agree.', settings));

    const changes: unknown[] = [];
    const restarted = createLlmGate({
      engine,
      settings: current,
      storage,
      onFailureChange: (failure) => changes.push(failure),
    });
    expect(await restarted.failure(settings)).toBe('no-key');
    expect(await failureOf(restarted.check('I am agree.', settings))).toBe('no-key');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(await failureOf(restarted.check('I am agree.', settings))).toBeUndefined();
    expect(changes).toEqual([undefined]);
  });

  it('asks the Provider again after the pause, and announces the failure and the recovery', async () => {
    const changes: unknown[] = [];
    const gate = createLlmGate({
      engine: (s) => createLlmEngine(s.llmProvider, s.llmApiKey, s.mixedInLanguage),
      settings: async () => settings,
      onFailureChange: (failure) => changes.push(failure),
    });
    responses.push(() => new Response('oops', { status: 500 }));
    await failureOf(gate.check('I am agree.', settings));
    expect(await gate.failure(settings)).toBe('bad-response');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(await failureOf(gate.check('I am agree.', settings))).toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await gate.failure(settings)).toBeUndefined();
    expect(changes).toEqual(['bad-response', undefined]);
  });

  it.each([
    ['key', { llmApiKey: 'new-key' }],
    ['Provider', { llmProvider: 'gemini' }],
  ] as const)('forgets a failure, and asks the Provider at once, after the %s changes', async (_, change) => {
    const gate = setup();
    responses.push(() => new Response('{}', { status: 401 }));
    await failureOf(gate.check('I am agree.', settings));
    const changed: Settings = { ...settings, ...change };

    expect(await gate.failure(changed)).toBeUndefined();
    expect(await failureOf(gate.check('I am agree.', changed))).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('drops a failure made with an old key: no announcement, and the next check asks the Provider at once', async () => {
    let current = settings;
    const changes: unknown[] = [];
    const gate = createLlmGate({
      engine: (s) => createLlmEngine(s.llmProvider, s.llmApiKey, s.mixedInLanguage),
      settings: async () => current,
      onFailureChange: (failure) => changes.push(failure),
    });
    // The user saves a new key while the check is on its way.
    responses.push(() => {
      current = { ...settings, llmApiKey: 'new-key' };
      return new Response('{}', { status: 401 });
    });

    const failed = await gate.check('I am agree.', settings).catch((error) => error);
    expect(failed).toMatchObject({ failure: 'no-key', retryAfterMs: 0 });
    expect(changes).toEqual([]);
    expect(await gate.failure(current)).toBeUndefined();

    expect(await failureOf(gate.check('I am agree.', current))).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
