# Type Right verification map

This directory is the maintained source for verifying what a Type Right user sees. Read this index before driving, then use the matching feature file as the recipe. Terms (Slip, Field, Engine, Hover card, Tally, Dictionary) are defined in the repo's `GLOSSARY.md`.

## Baseline preconditions

- `V launch` succeeded and `V doctor` passes, where `V` is `node .claude/skills/verify/scripts/verify.mjs`.
- A fresh profile, so default Settings: no LLM consent or key, empty site lists, empty Dictionary, empty Tally.
- `api.languagetool.org` is reachable. Every underline comes from the real public LanguageTool API.
- Never drive an instance this run did not launch.

## Driving conventions

- Field 0 is the test page's plain textarea; field 1 is the short, scrollable one; field 2 is taller than the window and sits under a sticky footer.
- Every recipe changes Settings or the Tally only in the throwaway profile. To start from the baseline again, run `cleanup`, then `launch`.
- Wait for underlines with `slips --wait <text>`, not a fixed sleep. A LanguageTool check runs about 600 ms after typing stops, plus the API's round trip.
- Use lowercase made-up words for spelling Slips. LanguageTool treats capitalised unknown words (`Zorblat`) as names and does not flag them.

## Proof and skip reporting

- Capture the action and the resulting state: the command log in `log.jsonl`, plus a screenshot of the field or card.
- Prove a stored change from a second view (Options list, Popup counts, the test page behaving differently), not from the click alone.
- If an entry point cannot be driven here, report it with the reason. Do not report it as verified through another path.

## Feature entry contract

Each feature file has an H1 title and one paragraph, then four H2s in this order:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with verify.mjs` (starting with `Preconditions:`)
4. `Gotchas`

## Features

- [Underlines and the Hover card](./underlines-and-hover-card.md): typing flags Slips by kind, the card explains each one, and Apply fixes a spelling Slip.
- [Ignore here and the Dictionary](./ignore-and-dictionary.md): hide one Slip in a Field, or stop a word being flagged anywhere, and manage the list on the Options page.
- [Popup Tally](./popup-tally.md): counts of finished Slips by kind and type in the toolbar Popup, and resetting them.
- [Site controls](./site-controls.md): turn Type Right off on a site, or keep a site's text away from the LLM.
- [Rich editors](./rich-editors.md): fixture pages on the real editor libraries, and the `V rich-editors` matrix that gates each Rich editor ticket.
- [LLM check and consent](./llm-check.md): the first-run setup page (Provider, API key, consent), the LLM badge, and wording and Translation Slips from the LLM.
