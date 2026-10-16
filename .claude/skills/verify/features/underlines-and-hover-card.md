# Underlines and the Hover card

When a user pauses typing in any textarea, Type Right underlines each Slip in place: red for spelling, blue for grammar. Resting the mouse on an underline opens the Hover card with the Slip's kind, type and explanation. The answer stays hidden until `Show answer` is pressed. A spelling Slip offers `Apply` for each suggestion, which replaces the word in the field.

## Sub-features

- `underline-spelling` flags a misspelled word in red.
- `underline-grammar` flags a grammar Slip in blue.
- `underline-follow` keeps underlines on the right words while the user edits, and drops one once its word is fixed.
- `card-open` opens the Hover card after about 300 ms over an underline.
- `card-answer` reveals the suggestions on `Show answer`.
- `card-apply` replaces a spelling Slip's text with the chosen suggestion.

## How to get to it (user POV)

- Type into any `<textarea>` on any http(s) page, then pause.
- Point at an underlined word.

## Driving it with verify.mjs

Preconditions:

- Baseline from the index. Field 0 is empty or about to be cleared.

- **Spelling underline.** Type a misspelling and pause. Run `V type "I will recieve it." --clear` and `V slips --wait recieve`. The output lists `{ "text": "recieve", "kind": "spelling" }`.
- **Grammar underline.** Run `V type "Teh cat sat. I seen him yesterday." --clear --field 1` and `V slips --field 1 --wait seen`. The output lists `Teh` as spelling and `seen` as grammar.
- **Open the card.** Point at the word. Run `V hover recieve`. The card shows kind `Spelling`, type `Spelling mistake`, an explanation, no suggestions yet, and the buttons `Show answer`, `Ignore here`, `Add to dictionary`. Run `V screenshot hover-card`.
- **Reveal the answer.** Run `V click-card "Show answer"`. The suggestions include `receive`, and the buttons now include `Apply receive`.
- **Apply.** Run `V click-card "Apply receive"`. The card closes. `V value` prints `I will receive it.`, and `V slips` prints `[]`. Run `V screenshot after-apply`.

## Gotchas

- Grammar Slips get no `Apply` and no `Add to dictionary`: the user retypes them. Checking for those buttons on a grammar card proves nothing.
- `Apply` buttons only exist once `Show answer` has been clicked.
- The card closes on the next keystroke in the field. Run `hover` again after typing.
- Capitalised unknown words are taken as names and not flagged. Use lowercase misspellings.
- The public LanguageTool API allows about 20 requests a minute. Many fast runs back off for 30 s or more, during which `slips --wait` times out. Re-run `doctor` and wait.
