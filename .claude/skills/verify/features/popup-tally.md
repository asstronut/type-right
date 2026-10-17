# Popup Tally

The toolbar Popup shows how many Slips the user has made, grouped by kind and type, most frequent first. A Slip is counted once, when its sentence is finished: it ends in `.`, `?`, `!` or a line break. While the LLM is active, it is counted only after the LLM has also checked it. `Reset counters` clears the Tally.

## Sub-features

- `tally-count` counts each distinct finished Slip once, by kind and type.
- `tally-unfinished` does not count a Slip until its sentence is finished.
- `tally-reset` clears every count.

## How to get to it (user POV)

- Click the Type Right toolbar icon.

## Driving it with verify.mjs

Preconditions:

- Baseline from the index (empty Tally). The LLM is not active, so LanguageTool Slips count as soon as their sentence is finished.

- **Make finished Slips.** Run `V type "I will recieve it." --clear` and `V slips --wait recieve`, then `V type "Teh cat sat. I seen him yesterday." --clear --field 1` and `V slips --field 1 --wait seen`.
- **Read the Popup.** Run `V popup` and `V eval "document.querySelector('#counts').innerText" --tab popup`. It shows `SPELLING 2` (`Spelling mistake 2`) and `GRAMMAR 1` (`Possible grammatical error 1`). Run `V screenshot tally --tab popup`.
- **Unfinished sentence.** Run `V type "I recieve" --clear` with no final period, then reopen the Popup (`V close popup`, `V popup`). The spelling count is unchanged.
- **Reset.** Run `V click "#reset" --tab popup`. `#countsEmpty` becomes visible and `#counts` is empty.

## Gotchas

- `V open popup` opens `popup.html` as an ordinary tab, which is fine for counts. `V popup` opens the real toolbar Popup, which is 332 px wide.
- Re-typing the same misspelling in the same sentence counts once, because counts are keyed by kind, sentence and flagged text.
- `tally-unfinished` and `tally-reset` have not been driven yet. Fix these steps once they have been run.
