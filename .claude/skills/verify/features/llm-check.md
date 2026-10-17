# LLM check and consent

No text goes to the LLM until the user accepts the selected Provider (GLM or Gemini) on the Consent page and sets an API key on the Options page. Once both are done, finished sentences are also checked by the LLM: it catches unnatural wording (purple underlines) and gives better explanations. Each Field's badge says whether its text goes to the LLM: `LLM` in green when active, `LT only` in grey, and `LLM` in red when paused after a failure.

## Sub-features

- `consent-install` opens the Consent page on install, naming the Provider.
- `consent-decline` keeps LanguageTool only. The badge reads `LT only`, with the "not allowed" tooltip.
- `consent-accept` together with a key turns the badge green `LLM`.
- `llm-wording` flags wording Slips in purple on finished sentences.
- `llm-failing` turns the badge red and pauses the LLM for 60 s after a failure (for example a bad key). LanguageTool keeps working.
- `provider-switch` clears the key and reopens the Consent page.

## How to get to it (user POV)

- The Consent page opens by itself on install.
- Options page: the Provider select, the `llmApiKey` field and the `llmConsent` checkbox.

## Driving it with verify.mjs

Preconditions:

- Baseline from the index. The Consent tab is open (`V tabs` lists `consent.html`).
- For `consent-accept` and `llm-wording`: a real Provider key. Keys are in the gitignored `.env.local` (`Z_AI_API_KEY` for GLM, `GEMINI_API_KEY` for Gemini). Ask the user before using one: it spends their quota and sends test text to Z.ai or Google.

- **No consent yet.** Run `V badge`. It reads `LT only`, with a tooltip that sending text to the LLM is not allowed.
- **Decline.** Run `V click "#decline" --tab consent`. The badge still reads `LT only`.
- **Accept and key (approved key only).** Run `V click "#accept" --tab consent`. Then run `V open options`, focus `llmApiKey`, type the key, and save with `V click 'button[type=submit]' --tab options`. `type` only addresses textareas, so focus the input with `V click 'input[name=llmApiKey]' --tab options` before typing. Then `V badge` reads `LLM` in green (`rgb(22, 163, 74)`).
- **Wording Slip.** Type a finished sentence with unnatural wording and pause about 2 s, then run `V slips`. A purple `wording` Slip appears.
- **Bad key.** Save a wrong key. Type a finished sentence. The badge turns red `LLM` and its tooltip names the failure. LanguageTool underlines still appear.

## Gotchas

- Only the "no consent" badge has been driven here so far. Fix each step above once it has been run.
- `type` cannot fill `<input>` fields yet; it addresses textareas by index. Extend `verify.mjs` with an input-typing command before driving the key steps, and keep the key out of `log.jsonl`.
- After a failure, the LLM gate refuses every check for 60 s, even with a good key. A fix only shows after that, or after changing the key or Provider (which clears the failure).
- The LLM only checks finished sentences (ending in `.`, `?`, `!` or a line break), after about 1.5 s of pause.
