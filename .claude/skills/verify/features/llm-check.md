# LLM check and consent

No text goes to the LLM until the user accepts the selected Provider (GLM or Gemini) on the Consent page and sets an API key on the Options page. Once both are done, finished sentences are also checked by the LLM: it catches unnatural wording (purple underlines) and gives better explanations. With Mixed-in language set to Indonesian, it also flags Indonesian words as Translation Slips (teal underlines). Each Field's badge says whether its text goes to the LLM: `LLM` in green when active, `LT only` in grey, and `LLM` in red when paused after a failure.

## Sub-features

- `consent-install` opens the Consent page on install, naming the Provider.
- `consent-decline` keeps LanguageTool only. The badge reads `LT only`, with the "not allowed" tooltip.
- `consent-accept` together with a key turns the badge green `LLM`.
- `llm-wording` flags wording Slips in purple on finished sentences.
- `llm-translation` flags Indonesian words in teal with Mixed-in language set to Indonesian. The Hover card reads `Translation`, keeps the English behind `Show answer` and has no `Apply`. The Popup counts them under Translation.
- `llm-failing` turns the badge red and pauses the LLM for 60 s after a failure (for example a bad key). LanguageTool keeps working.
- `provider-switch` clears the key and reopens the Consent page.

## How to get to it (user POV)

- The Consent page opens by itself on install.
- Options page: the Provider select, the `llmApiKey` field, the `llmConsent` checkbox and the `mixedInLanguage` select.

## Driving it with verify.mjs

Preconditions:

- Baseline from the index. The Consent tab is open (`V tabs` lists `consent.html`).
- For `consent-accept` and `llm-wording`: a real Provider key. Keys are in the gitignored `.env.local` (`Z_AI_API_KEY` for GLM, `GEMINI_API_KEY` for Gemini). Ask the user before using one: it spends their quota and sends test text to Z.ai or Google.

- **No consent yet.** Run `V badge`. It reads `LT only`, with a tooltip that sending text to the LLM is not allowed.
- **Decline.** Run `V click "#decline" --tab consent`. The badge still reads `LT only`.
- **Accept and key (approved key only).** Run `V click "#accept" --tab consent`. Then run `V open options`, focus `llmApiKey`, type the key, and save with `V click 'button[type=submit]' --tab options`. `type` only addresses textareas, so focus the input with `V click 'input[name=llmApiKey]' --tab options` before typing. Then `V badge` reads `LLM` in green (`rgb(22, 163, 74)`).
- **Wording Slip.** Type a finished sentence with unnatural wording and pause about 2 s, then run `V slips`. A purple `wording` Slip appears.
- **Stubbed LLM, no real key.** Write a replies file mapping a sentence to the entries the model would return, and run `V stub-llm <file>` before typing. Accept consent, then `V open options`, `V click 'input[name=llmApiKey]' --tab options`, `V keys "test-key" --tab options` and save. The badge reads green `LLM`, and `log.jsonl` records each stubbed answer.
- **Translation Slip (stubbed).** Stub `I already ngecek the logs tapi masih error.` with `translation` entries for `already ngecek` and `tapi masih error`. On Options, `V click 'select[name=mixedInLanguage]' --tab options`, `V press ArrowDown --tab options`, `V press Enter --tab options`, then save. Run `V type "I already ngecek the logs tapi masih error." --clear` and `V slips --wait "already ngecek"`: both spans are `translation`, and no spelling Slip is left on `ngecek`. `V hover "already ngecek"` shows kind `Translation` with `Show answer` and `Ignore here` only; after `Show answer` there is still no `Apply`. The Popup `#counts` lists Translation 2.
- **Bad key.** Save a wrong key. Type a finished sentence. The badge turns red `LLM` and its tooltip names the failure. LanguageTool underlines still appear.

## Gotchas

- Driven so far: the "no consent" badge, and consent, a dummy key, Mixed-in language and Translation Slips with `stub-llm`. Fix each other step above once it has been run.
- `type` addresses textareas by index; use `click` plus `keys` for `<input>` fields. Never type a real API key with `keys`: it goes through the page like any keystroke. Use `stub-llm` with a dummy key instead.
- `hover` on a second underline while a card is still open can return the open card. Move away or press Escape in the field first, and check the card's type before clicking its buttons.
- After a failure, the LLM gate refuses every check for 60 s, even with a good key. A fix only shows after that, or after changing the key or Provider (which clears the failure).
- The LLM only checks finished sentences (ending in `.`, `?`, `!` or a line break), after about 1.5 s of pause.
