# LLM check and consent

No text goes to the LLM until the user, on the setup page (`consent.html`), picks a Provider (GLM or Gemini), pastes its API key and allows its checks. The page opens by itself on install and again when the Provider is switched in Options. Once allowed, finished sentences are also checked by the LLM: it catches unnatural wording (purple underlines) and gives better explanations. With Mixed-in language set to Indonesian in Options, it also flags Indonesian words as Translation Slips (teal underlines). Each Field's badge says whether its text goes to the LLM: `LLM` in green when active, `LT only` in grey, and `LLM` in red when paused after a failure.

## Sub-features

- `setup-install` opens the setup page on install, with the stored Provider's card selected.
- `setup-provider` picks a Provider by clicking its card. The key label, the "Get a key" link, the disclosure and the Accept button name it, and focus moves to the key input.
- `setup-accept` saves the Provider, key and consent in one step. The form gives way to "<Provider> checks are on.", and the badge turns green `LLM`.
- `setup-decline` keeps LanguageTool only. The page says so and links to Settings. The badge reads `LT only`, with the "not allowed" tooltip.
- `setup-live` re-renders the page when the Provider, key or consent change in another tab. A key being typed survives unrelated saves, such as a site list.
- `llm-wording` flags wording Slips in purple on finished sentences.
- `llm-translation` flags Indonesian words in teal with Mixed-in language set to Indonesian. The Hover card reads `Translation`, keeps the English behind `Show answer` and has no `Apply`. The Popup counts them under Translation.
- `llm-failing` turns the badge red and pauses the LLM for 60 s after a failure (for example a bad key). LanguageTool keeps working.
- `provider-switch` in Options clears the key and reopens the setup page for the new Provider.

## How to get to it (user POV)

- The setup page opens by itself on install. It can also be opened as `consent.html` (`V open consent`).
- Options page: the Provider select, the `llmApiKey` field, the `llmConsent` checkbox and the `mixedInLanguage` select.

## Driving it with verify.mjs

Preconditions:

- Baseline from the index. The setup tab is open (`V tabs` lists `consent.html`).
- Every step up to the badge works with a made-up key, such as `dummy-gemini-key-123`. A made-up key only fails once a finished sentence reaches the Provider.
- For `llm-wording` and `llm-failing` with a real failure: a real Provider key. Keys are in the gitignored `.env.local` (`Z_AI_API_KEY` for GLM, `GEMINI_API_KEY` for Gemini). Ask the user before using one: it spends their quota and sends test text to Z.ai or Google.

- **First run, accept.** `V screenshot setup-form --tab consent`. Pick Gemini with `V click "label.card:nth-child(2)" --tab consent`. Type the key with `V type "<key>" --tab consent --selector "input[name=llmApiKey]"`; it prints only the length. Click `V click "#accept" --tab consent`. Read the result with `V eval "document.querySelector('#status').textContent" --tab consent` (`Google Gemini checks are on.`) and `V sw-eval "chrome.storage.local.get(null)"` (`llmProvider: "gemini"`, the key, `llmConsent: true`). Then `V badge` reads `LLM` in green (`rgb(22, 163, 74)`).
- **First run, decline.** On a fresh launch, run `V click "#decline" --tab consent`. `#status` reads `Only LanguageTool will check your text.` and `#settingsLink a` opens Options. Storage has `llmConsent: false`, and `V badge` reads `LT only`.
- **Live re-render.** With the page accepted, `V open options`, untick consent with `V click "input[name=llmConsent]" --tab options` and save with `V click "button[type=submit]" --tab options`. The setup page shows the form again with the stored Provider and key.
- **Wording Slip (approved key only).** Type a finished sentence with unnatural wording and pause about 2 s, then run `V slips`. A purple `wording` Slip appears.
- **Stubbed LLM, no real key.** Write a replies file mapping a sentence to the entries the model would return, and run `V stub-llm <file>` before typing. Accept on the setup page with a made-up key. The badge reads green `LLM`, and `log.jsonl` records each stubbed answer.
- **Translation Slip (stubbed).** Stub `I already ngecek the logs tapi masih error.` with `translation` entries for `already ngecek` and `tapi masih error`. Run `V open options`, `V click "select[name=mixedInLanguage]" --tab options`, `V press ArrowDown --tab options`, `V press Enter --tab options`, then save with `V click "button[type=submit]" --tab options`. Run `V type "I already ngecek the logs tapi masih error." --clear` and `V slips --wait "already ngecek"`: both spans are `translation`, and no spelling Slip is left on `ngecek`. `V hover "already ngecek"` shows kind `Translation` with `Show answer` and `Ignore here` only; after `Show answer` there is still no `Apply`. The Popup `#counts` lists Translation 2.
- **Bad key.** Accept with a wrong key. Type a finished sentence. The badge turns red `LLM` and its tooltip names the failure. LanguageTool underlines still appear.

## Gotchas

- The setup page reads Settings when it loads and on every change, so an earlier run's consent shows the accepted view at once. Start from a fresh launch for the form.
- `click` alone cannot pick a `<select>` option. Click the select, then `press ArrowDown` (or `ArrowUp`) and `press Enter`. This has been driven for `mixedInLanguage`, not yet for the Provider select.
- A stubbed run proves what the extension does with a reply, not what the model replies. Never type a real API key without the user's approval; `stub-llm` with a made-up key needs none.
- `hover` on a second underline while a card is still open can return the open card. Move away or press Escape in the field first, and check the card's type before clicking its buttons.
- After a failure, the LLM gate refuses every check for 60 s, even with a good key. A fix only shows after that, or after changing the key or Provider (which clears the failure).
- The LLM only checks finished sentences (ending in `.`, `?`, `!` or a line break), after about 1.5 s of pause.
- Tabs open before install or reload keep no content script until they are reloaded. The verify test page gets one because Edge loads the extension before the page.
