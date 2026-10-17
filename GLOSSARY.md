# Type Right

A personal browser extension that flags slips in your English as you type, so you can learn from them and fix them yourself instead of being auto-corrected.

## Language

### Checking

**Field**:
A `<textarea>` on a page that Type Right watches. Each Field has its own Slips, ignore list and LLM badge.
_Avoid_: input, box, editor

**Slip**:
One language mistake flagged on a span of a Field's text. It has a Kind, a Type, an explanation and maybe suggestions. In code: `Slip`.
_Avoid_: error (that means a failure in the code or app), issue, match, problem, mistake

**Kind**:
One of four fixed groups a Slip belongs to: **spelling** (red), **grammar** (blue), **wording** (purple), **translation** (teal). It sets the underline color.
_Avoid_: category, severity

**Type**:
The free-text label naming what exactly is wrong, e.g. "Subject-verb agreement". Each Kind has many Types.
_Avoid_: rule, kind (it's not one)

**Wording**:
The Kind for text that is correct but sounds unnatural to a native speaker. Only the LLM reports it.
_Avoid_: style, phrasing, unnatural

**Translation**:
The Kind for a word or phrase in the Mixed-in language. Its explanation says what the words mean; its answer is the English that fits there. Only the LLM reports it, and only while a Mixed-in language is set.
_Avoid_: foreign word, non-English

**Engine**:
A service that finds Slips in text. There are two: LanguageTool and the LLM.
_Avoid_: checker, backend

**LanguageTool**:
The Engine that checks the edited paragraph for spelling and grammar after a short pause.

**LLM**:
The Engine that checks Finished sentences one at a time. It finds Wording Slips and gives clearer explanations. Its Provider is GLM or Gemini.
_Avoid_: AI, model

**Provider**:
The company whose LLM gets the text (GLM by Z.ai, or Google Gemini). Switching it needs fresh Consent and a new API key.

**Finished sentence**:
A sentence ending in `.`, `?` or `!`, or a line ended by a line break. Only these go to the LLM and get counted.
_Avoid_: complete sentence

**LLM health**:
Whether text typed on a page goes to the LLM: **active**, **lt-only** (the user chose not to send it) or **failing** (it should go but can't right now). Every Field on a page has the same LLM health, and each Field's LLM badge shows it. A failure is shared: when the LLM fails for one Field, every Field in every tab turns failing, and the next success turns them all active.

### Your choices

**Ignore here**:
Hides one Slip everywhere in its Field until the page reloads.
_Avoid_: dismiss, skip

**Dictionary**:
The user's own words, which are never flagged as spelling Slips on any site.
_Avoid_: word list, allowlist

**Excluded site**:
A site whose text never goes to the LLM. LanguageTool still runs there.
_Avoid_: blocked site

**Disabled site**:
A site where Type Right is completely off: no checking, no underlines.
_Avoid_: excluded site (that's a different list)

**Mixed-in language**:
The language the user mixes into their English when they don't know the English word yet: None (the default) or Indonesian. While it is set, the LLM reports its words as Translation Slips.
_Avoid_: second language, native language

**Consent**:
The user's acceptance that their text goes to the current Provider, given on the setup page together with that Provider's API key. Without it there are no LLM calls.

### Learning

**Hover card**:
The card that opens when the pointer rests on an underline. It shows the Slip's Type, an explanation and a hidden answer.
_Avoid_: tooltip, popup (that's the Popup)

**Apply**:
Replaces a Slip's text with the suggested fix in one click. Only spelling Slips offer it; grammar, wording and translation you retype yourself.

**Tally**:
The Popup's counts of distinct Slips, by Kind and then by Type. Each distinct Slip counts once, after its sentence is finished.
_Avoid_: stats, score, error counter, slip counter

**Popup**:
The panel that opens from the toolbar icon. It shows the Tally, the reset button and the site buttons.
_Avoid_: hover card

**Reset**:
Zeroes the Tally and forgets which Slips were counted, so Slips still on screen count again.
