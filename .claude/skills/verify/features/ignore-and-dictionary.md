# Ignore here and the Dictionary

From a Slip's Hover card, a user can hide that Slip everywhere in the current Field until the page reloads (`Ignore here`). For a spelling Slip, they can also stop the word being flagged anywhere (`Add to dictionary`). The Options page lists Dictionary words, each with a Remove button.

## Sub-features

- `ignore-here` removes the underline for that Slip in this Field only, until reload.
- `dict-add` removes the underline at once and stores the word.
- `dict-list` shows the word on the Options page under the Dictionary.
- `dict-remove` removes the word from the Options page, so it is flagged again.

## How to get to it (user POV)

- Hover an underlined Slip and choose `Ignore here` or `Add to dictionary`.
- Right-click the extension icon, choose Options, then see the Dictionary section.

## Driving it with verify.mjs

Preconditions:

- Baseline from the index. The word `zorblat` is not in the Dictionary.

- **Ignore here.** Run `V type "Teh cat sat. I seen him yesterday." --clear --field 1`, `V slips --field 1 --wait Teh`, `V hover Teh --field 1` and `V click-card "Ignore here"`. `V slips --field 1` then lists only `seen`.
- **Add to dictionary.** Run `V type "I like the zorblat sound." --clear`, `V slips --wait zorblat`, `V hover zorblat` and `V click-card "Add to dictionary"`. `V slips` prints `[]`.
- **Second view: Options.** Run `V open options` and `V eval "document.querySelector('#dictionary').innerText" --tab options`. It prints `zorblat` and `Remove`. Run `V screenshot dictionary --tab options`.
- **Remove.** Click Remove: `V click "#dictionary button" --tab options`. Retype `zorblat` in field 0 and run `V slips --wait zorblat`; the underline is back.

## Gotchas

- `Add to dictionary` only appears on spelling Slips.
- Ignore here is per Field and lasts until reload. The same Slip in the other Field stays underlined, and that is correct, not a bug.
