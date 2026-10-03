export type LlmProviderId = 'glm' | 'gemini';

/**
 * Everything that differs between LLM providers. All of them take the
 * OpenAI-compatible chat completions request with a Bearer API key.
 */
export interface LlmProvider {
  /** Name shown on the Options and Consent pages. */
  name: string;
  /** Who receives the text and where they operate, in plain words for the disclosure. */
  recipient: string;
  /** The kind of key the user should paste, for the Options page hint. */
  keyName: string;
  apiUrl: string;
  model: string;
  /** Asked once instead when `model` is overloaded. */
  fallbackModel: string;
  /** Provider-specific fields added to every request body. */
  extraFields: Record<string, unknown>;
  /** Whether a response means the model is overloaded, as opposed to this key being rate-limited. */
  isOverloaded(response: Response): Promise<boolean>;
}

export const DEFAULT_LLM_PROVIDER: LlmProviderId = 'glm';

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProvider> = {
  glm: {
    name: 'GLM',
    recipient: 'Zhipu AI / Z.ai, a provider in China',
    keyName: 'a GLM (Z.ai) API key',
    apiUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
    model: 'glm-4.7-flash',
    fallbackModel: 'glm-4.5-flash',
    extraFields: { thinking: { type: 'disabled' } },
    // Z.ai sends HTTP 429 with business code 1305 for "the service may be temporarily overloaded".
    isOverloaded: async (response) =>
      response.status === 429 && String((await errorBody(response))?.code) === '1305',
  },
  gemini: {
    name: 'Google Gemini',
    recipient: 'Google, a provider in the United States',
    keyName: 'a Gemini API key from Google AI Studio',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-3.8-flash',
    fallbackModel: 'gemini-3.5-flash-lite',
    // The lowest thinking level both models accept.
    extraFields: { reasoning_effort: 'low' },
    // Overload is 503 UNAVAILABLE; 429 RESOURCE_EXHAUSTED is this key's quota.
    isOverloaded: async (response) => response.status === 503,
  },
};

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === 'string' && Object.hasOwn(LLM_PROVIDERS, value);
}

/** The `error` object of a JSON error response, if it has one. */
async function errorBody(response: Response): Promise<{ code?: unknown } | undefined> {
  try {
    return ((await response.clone().json()) as { error?: { code?: unknown } }).error;
  } catch {
    return undefined;
  }
}
