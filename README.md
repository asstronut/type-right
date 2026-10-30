# Type Right

Personal Chrome extension that checks your English as you type, in any `<textarea>` and in Rich editors such as Gmail's or Slack's composer, with no "check" button. It underlines each slip (a spelling, grammar or wording mistake, or a word in another language you mixed in; see [GLOSSARY.md](GLOSSARY.md)) in place, colored by kind. The goal is to **learn**, not to be auto-corrected: for each one you'll see what kind it is and why it's wrong, and you fix it yourself.

Full v1 spec: [issue #1](https://github.com/asstronut/type-right/issues/1).

> Status: early (v0.1.0), Chrome / Edge, unpacked install only. LanguageTool and LLM (GLM or Google Gemini) engines both run.

## How it will work (v1)

- **Underlines by kind:** spelling (red), grammar (blue), unnatural wording (purple), translation (teal).
- **Hover card** (~300 ms): the Slip's type, short explanation in simple English, corrected text hidden behind "Show answer". "Apply" only for spelling; grammar, wording and translation you retype. "Ignore here" hides that Slip everywhere in the field until the page reloads; "Add to dictionary" (spelling only) stops a word being flagged anywhere, and the Options page lists the words with Remove buttons.
- **Two engines:**
  - [LanguageTool](https://languagetool.org) (free public API): fast spelling and grammar underlines after you pause.
  - **LLM**, your choice of provider on the setup page shown at install (or later on the Options page): **GLM** (`glm-4.7-flash`, Zhipu AI / Z.ai; the default) or **Google Gemini** (`gemini-3.8-flash`). Runs on finished sentences, catches unnatural wording, better explanations.
- **Privacy controls:** consent at install before any LLM call (asked again whenever you switch provider), an "LLM" badge on every field sent to the LLM, per-site exclusion list (LanguageTool only on those sites).
- **Mixed-in language** (Options page, None by default): set it to Indonesian and the LLM reports each Indonesian word or phrase you mix into your English (slang like gue, gak, ngecek, -nya included) as a Translation Slip. The Hover card says what it means, the English is behind "Show answer", and the Popup counts them, while the English around it is still checked. LanguageTool knows no Indonesian, so until the LLM has checked a Finished sentence (or wherever the LLM is off) it still flags Indonesian words as spelling Slips.
- **Extras:** ignore here, personal dictionary, popup with Slip counts per type, US/UK English, configurable LanguageTool URL.

## Quick start

Requires Node.js and npm.

```bash
npm install
npm run build
```

Then in Chrome or Edge:

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** and select `.output/chrome-mv3`.
3. Serve the local test page and type `I will recieve it` in a textarea:

```bash
npm run serve:testpage
```

Test page: <http://localhost:5173>. You should see a red underline under "recieve" within about a second.

For development with hot reload, run `npm run dev`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | WXT dev mode with auto-reload |
| `npm run build` | Production build to `.output/` |
| `npm run compile` | Type-check (`tsc --noEmit`) |
| `npm test` | Run tests once (Vitest) |
| `npm run test:watch` | Tests in watch mode |
| `npm run serve:testpage` | Serve `test-page/` on port 5173 |
| `npm run eval:llm [provider]` | Score the LLM prompt on `eval/llm/fixture.ts` (real API; provider id defaults to `gemini`; key variable per `KEY_VARIABLES` in `eval/llm/run.ts`, env or `.env.local`) |

## Architecture

```
content script                    background worker
(Field, highlights, checker)      (Engine -> Slip[])

  --check-field msg------->         --POST /v2/check--------->  LanguageTool
  --check-sentence msg---->         --POST chat/completions-->  GLM (Z.ai) or Gemini (Google)
  <-----------Slip[]-------
```

The LLM leg goes to whichever provider is selected in Settings; both take the same OpenAI-compatible chat completions request.

Network calls run in the background service worker so API keys never reach page scripts and page CSP doesn't matter.

- `entrypoints/content/`: makes every textarea a Field, and each Rich editor one the first time it gets focus (on install and update the background worker also injects it into tabs already open, so they need no reload), ends a Field when its element leaves the page, and leaves the page once the extension reloads or updates ([page.ts](entrypoints/content/page.ts), tested in [page.test.ts](entrypoints/content/page.test.ts) on a happy-dom page with a stand-in for CSS highlights).
  - [fields/field.ts](entrypoints/content/fields/field.ts): what every kind of Field shares. A `FieldAdapter` delivers reads, each a snapshot of the text with a way to build ranges over that same text; the Field passes each read to the checker, draws the Slips, shows the LLM badge and answers the Hover card's buttons (Apply, Ignore here, Add to dictionary). A read with the same text as the last one redraws the underlines but leaves an open Hover card alone. Tested in [field.test.ts](entrypoints/content/fields/field.test.ts) with an in-memory adapter.
  - [fields/textarea.ts](entrypoints/content/fields/textarea.ts): the textarea adapter. It reads on `input`, ranges with `createValueRange` (`OpaqueRange`), and applies a fix through `execCommand('insertText')`, so one Ctrl+Z undoes it. A pre-filled textarea is checked at once unless it is disabled, read-only or hidden ([fields/hidden.ts](entrypoints/content/fields/hidden.ts)); then it waits for its first `input`.
  - [fields/rich-editor.ts](entrypoints/content/fields/rich-editor.ts): the Rich editor adapter and the rules for which regions become Fields. A focus maps to its editing host, the outermost editable element, and the host is skipped when it is single-line by ARIA (`combobox`, `searchbox`, `aria-multiline="false"`), hidden, or inside CodeMirror, Monaco or Ace; the rules are judged once, at attach, and a skipped host is judged again on its next focus. It reads at attach and after every `MutationObserver` batch on the host (no `input` events), each batch in full even when the text is the same, since editors re-render nodes with identical text and leave the old ranges on detached nodes. Apply is off in a Rich editor for now. Tested in [rich-editor.test.ts](entrypoints/content/fields/rich-editor.test.ts) and, through `runPage`, in [page.test.ts](entrypoints/content/page.test.ts).
  - [fields/rich-text.ts](entrypoints/content/fields/rich-text.ts): reads an editor's DOM as the text the same lines would make in a textarea. Blocks and `<br>`s are one line break each, an empty block is an empty line, a trailing or placeholder `<br>` adds nothing and the text has no trailing line break; zero-width characters, scripts, images, hidden nodes and placeholders are left out of it. The text and its sorted text-node segments come from one walk, and a `StaticRange` is found for a span by binary search over the segments, so it can cross bold or italic; a read whose nodes changed since gives ranges over nothing. Tested in [rich-text.test.ts](entrypoints/content/fields/rich-text.test.ts) on markup shaped like ProseMirror, TipTap, Quill, Draft.js, Gmail and Slate.
  - [underlines.ts](entrypoints/content/underlines.ts): one wavy CSS highlight per Kind (`type-right-spelling`, `-grammar`, `-wording`, `-translation`) shared by every Field on the page. It registers a name again whenever the page cleared or replaced it, never calls `CSS.highlights.clear()`, and on teardown deletes a name only while it still holds our own highlight. Hover finds the Slip under the pointer with `highlightsFromPoint` at the pointer and 3 and 6 px above it, since the line sits below the glyphs. Tested in [underlines.test.ts](entrypoints/content/underlines.test.ts).
  - [badge.ts](entrypoints/content/badge.ts) draws the LLM badge in a Field's bottom-right corner; [hover.ts](entrypoints/content/hover.ts) and [hover-card.ts](entrypoints/content/hover-card.ts) open, place and close the Hover card.
- `entrypoints/background.ts`: receives text via message, calls the engine with the current Settings (English variant, LanguageTool URL, LLM provider and key, Mixed-in language). LLM checks go through one shared gate ([llm-gate.ts](lib/llm-gate.ts)): after a failure it refuses every check for 60 s without contacting the provider (the pause survives worker restarts in `storage.session`), and broadcasts the failure's reason (and the next success) to every tab, so all LLM badges change together; the broadcast never carries the key. A failure belongs to the Provider and key it happened with: changing either clears it, and a failure that lands after the change is dropped. Also applies `record-slips` / `reset-tally` messages to the Popup's counts one at a time.
- `entrypoints/options/`: Options page (right-click the extension icon → Options). Switching LLM provider clears the key and reopens the setup page.
- `entrypoints/popup/`: toolbar Popup: Slip counts per kind (with its total) and type label, most frequent first, a reset button, and "Exclude this site from LLM" / "Turn off on this site" buttons for the current tab.
- `entrypoints/consent/`: setup page (`consent.html`), opened on install and on provider change. The user picks a provider, pastes its API key (with a link to where the provider issues keys) and allows its checks in one step, or skips to LanguageTool only. It re-renders when Settings change in another tab, so it never shows a stale provider or answer. No LLM calls until the user accepts.
- `lib/settings.ts`, `lib/store.ts`: `Settings` shape, defaults, site-list matching, provider-change rules (consent revoked, key dropped), `llmPermission` (the one function that says whether text on a site may go to the LLM, or why not), and the typed Store over `chrome.storage.local`. Tested in [settings.test.ts](lib/settings.test.ts).
- `lib/checker.ts`: per-field checker core, connecting three parts: the Slip tracker, one scheduler per Engine and the per-Engine checks. LanguageTool checks the paragraphs the edit touched, skipped on a Disabled site, and backs off on a rate limit (the server's wait, default 30 s, at least 1 s), then re-checks the blocked paragraph. The LLM checks finished sentences only (ending in `.`, `?`, `!` or a line break, ~1.5 s pause, cached by sentence text, cache dropped when the LLM provider or Mixed-in language changes; a check that never reaches the LLM is retried after 5 s, doubling up to 60 s; any wait for the LLM, including the pause after a failure, ends as soon as the LLM health turns active). Also reports Slips to the Tally. Tested in [checker.test.ts](lib/checker.test.ts).
  - [slip-tracker.ts](lib/slip-tracker.ts): the pure part: the field's text and each Engine's Slips, followed through every edit (shifted, or dropped when the edit changes their words), the dirty span still to check, and the merged view (the LLM's Slip wins where both flag the same words; Dictionary words dropped before that merge, Ignore here after it). No timers, Engines or Settings; tested in [slip-tracker.test.ts](lib/slip-tracker.test.ts).
  - [check-scheduler.ts](lib/check-scheduler.ts): debounce, one check at a time, and back-off, shared by both Engines. Each check says how long to wait; the scheduler doesn't know why.
- `lib/llm-health.ts`: the LLM health (`active`, `lt-only`, `failing`) every Field on a page shares, one per content script. It derives `lt-only` and a missing key from Settings, takes failures from the background gate through a link (ask for the current failure, listen for broadcasts; the real link, over runtime messaging, is in the content script), clears a failure at once when the key or Provider changes, and asks again after every Settings change and broadcast, since only the gate can tell a failure made with an old key. The checker asks it whether text may go to the LLM and when to retry; the content script shows it on every Field's LLM badge. Tested in [llm-health.test.ts](lib/llm-health.test.ts) and, with the checker, through the real health module, gate and LLM engine, joined by [llm-test-wiring.ts](lib/llm-test-wiring.ts) in place of the runtime messaging between the content script and the worker (that messaging is not tested); the gate in [llm-gate.test.ts](lib/llm-gate.test.ts).
- `lib/engine.ts`, `lib/engines/language-tool.ts`, `lib/engines/llm.ts`: `Engine` interface, the LanguageTool adapter, and the shared LLM adapter (prompt, plus a section asking for Translation Slips when a Mixed-in language is set, otherwise unchanged; JSON reply parsing, which drops `translation` Slips while it is None; locating quoted spans, one retry on the fallback model when the primary is overloaded; a plain rate limit backs off instead).
- `lib/llm-providers.ts`: one description per LLM provider: endpoint, models, extra request fields, overload detection, disclosure text, where to get a key.
  - GLM: `glm-4.7-flash`, falls back to `glm-4.5-flash` on HTTP 429 with code `1305`; sends `thinking: disabled`.
  - Gemini: `gemini-3.8-flash`, falls back to `gemini-3.5-flash-lite` on HTTP 503; HTTP 429 is a rate limit; sends `reasoning_effort: low`.
- `lib/slips.ts`: `Slip` shape and stable Slip ids (derived from kind + flagged text, not position, so re-flagging the same Slip yields the same id), plus the Popup's counting key (kind + sentence text + flagged text).
- `lib/slip-tally.ts`: the Popup's counts, stored in `chrome.storage.local`. The checker reports each Slip once its sentence is finished (ends in `.`, `?`, `!` or a line break) and, while the LLM is active, after the LLM has checked it; each distinct key is counted once. Tested in [checker.test.ts](lib/checker.test.ts) and [slip-tally.test.ts](lib/slip-tally.test.ts).
- `eval/llm/`: on-demand LLM prompt eval. [fixture.ts](eval/llm/fixture.ts) holds English sentences with expected Slip spans (plus correct sentences that must get none), checked with Mixed-in language None, and mixed Indonesian–English sentences with expected Kinds, checked with it set to Indonesian; [score.ts](eval/llm/score.ts) counts found, missed, wrong-Kind, false-positive and overlapping Slips; [run.ts](eval/llm/run.ts) sends the fixture through the real LLM Engine and prints results (`npm run eval:llm`, not part of `npm test`). Scoring is tested in [score.test.ts](eval/llm/score.test.ts), which runs in `npm test` without network.

## Privacy

Text in your textareas and in the Rich editors you click into (a Gmail or Slack composer, say) is sent to the public LanguageTool API (`https://api.languagetool.org`). The extension has host permission for all sites: its content script already runs on every page, and the same permission lets it start in tabs that were open at install and reach any LanguageTool server you set on the Options page. Network calls only go to the LanguageTool server and the selected LLM provider. Sites on the "Turn Type Right off" list get no checking at all. Finished sentences also go to the selected LLM provider, Zhipu AI / Z.ai (a provider in China) or Google (a provider in the United States), only after you accept that provider and set its API key on the setup page (shown on install, and again when you switch provider in Options), and never on sites in the "Never send to the LLM" list. Password fields and non-text inputs are never checked.

## Security note

v1 has no backend: the LLM API key lives in extension storage, which is fine for a personal unpacked build. If you ever distribute the extension, put the LLM call behind a small proxy first, or the key is exposed.

## Limits

- LanguageTool free tier (as of this project created): 20 requests/min, 20k chars/request, 75k chars/min, no SLA. The checker debounces (600 ms) and re-checks only the edited paragraph.
- Textareas and Rich editors in the page itself, not inside iframes or shadow roots. In a Rich editor, Apply is missing for now. US or UK English.
