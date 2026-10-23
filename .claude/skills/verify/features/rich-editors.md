# Rich editors

The regression gate for Type Right in Rich editors. Six fixture pages run the real editor libraries with the content shapes captured from live sites in #54, and `V rich-editors` drives each one, plus the test page's textareas, through every row below. It prints a pass/fail/n/a matrix with evidence per cell. Each implementation ticket of #50 names the cells it turns green. A later ticket may fix a cell's driver if the driver is wrong, but may not lower its pass bar.

## Sub-features

Columns: `ProseMirror` (ChatGPT), `TipTap` (claude.ai, LinkedIn), `Quill` (Slack, Gemini), `Draft` (X), `Gmail`, `Slate`, `Textarea` (`test-page/index.html`). "Rich" below means the first six.

| Group | Row | Columns | Passes when |
| --- | --- | --- | --- |
| Parity checklist | `underline-typing` | all | After `I will recieve it.` is typed, a `type-right-spelling` range in the Field covers exactly `recieve`. |
| | `underline-scroll` | all | After a mouse-wheel scroll of the Field's container, the range still sits on the word (±2 px). Textarea: field 1. |
| | `hover-card` | all | Resting the mouse on the range opens the Hover card (`Spelling` / `Spelling mistake`), fully inside the viewport and within 40 px of the word. |
| | `ignore-here` | all | A real click on `Ignore here` removes the range on `recieve` and keeps the one on `seen`. |
| | `dictionary` | all | `Add to dictionary` removes the range, and the Options page lists the word. The cell then removes the word again with the Options page's Remove button. Each column has its own word. |
| | `badge` | all | A badge reading `LLM` or `LT only` sits inside the Field's visible box. |
| | `tally` | all | A finished sentence with a Slip raises the Popup's Spelling count. |
| | `not-checked` | Rich | The prose gets a range, and no range touches `fixture.notChecked()` (code blocks, quotes, Gmail's signature and quoted history). |
| | `never-flagged` | Rich | No range touches `fixture.neverFlag()` (chips, image emoji, inline code). Every range's text is a stubbed phrase, so no offset drifts. Quill and Gmail: the word after the image emoji has a range exactly on it. |
| | `apply-undo` | all | After 1.6 s idle, `Show answer` and `Apply receive` give exactly the text with the word replaced. One Ctrl+Z restores the whole text, and the Slip comes back. |
| Robustness | `rerender-bold` | Rich | After the fixture bolds `recieve` through its library, a live range still covers it. |
| | `rerender-remote` | Rich | After a remote edit inserts a first paragraph, a live range still sits on `recieve`. |
| | `replaced-root` | Rich | After `fixture.replaceRoot()`, no range points into the old root, and typing in the new root gets a range. |
| | `highlights-cleared` | all | After the page calls `CSS.highlights.clear()`, the range is back after a hover or, failing that, after the next typed character. |
| | `decoys` | Rich | The cell pokes the decoys: it clicks Gmail's combobox and types into it, and it presses Ctrl+V in Quill, which focuses `ql-clipboard`. Precondition: each poke focuses its decoy. Then only the focused host gets ranges and a badge, and no LanguageTool request contains `dekoy`. |
| Coexistence | `native-squiggle` | all | With spellcheck on (the cell turns it on, also on Gmail) and after a real click, the Hover card opens with the pointer 2 px and 5 px below `recieve`. Precondition: native squiggle pixels in a crop under the word. The crop is taken with Type Right's own highlights and overlays removed for one frame, so our line can't hide the native one. |
| Change detection | `ime` | all | `Input.imeSetComposition("nihao")` plus 2 s gives no LanguageTool request containing `nihao` and no range. After `Input.insertText`, a request contains it. |
| | `long-content` | Gmail, ProseMirror (`?variant=long`) | From a CDP trace, the content script's time per keystroke task has p95 ≤ 4 ms at 1× (4× recorded), and no task after the attach read spends over 50 ms in it during the first check (the attach read is recorded). The typed Slip gets a range. ProseMirror also needs ≥720 of its ~800 seeded Slips underlined. |
| Apply timing | `apply-timing` | Rich | 20 Apply trials at 1× and at 4× CPU throttle. Zero `changedWrongly`, ≥19/20 `accepted` at 1×, ≥17/20 at 4×. The result is read from the editor's own text 600 ms after the click. |
| Placement | `badge-clipped` | all | With the host cut by its scroller (Textarea: field 2 cut by the viewport), a badge sits inside the visible box. |
| | `card-unrelated-scroll` | all | With the card open, the page scrolling `#other-scroller` by 200 px leaves it open. |
| | `card-own-scroll` | all | Scrolling the Field's container by 6 px keeps the card open and moves it by 6 px (±2). Once the word leaves the visible box, the card closes. Textarea: field 1. |
| | `badge-resize` | all | After the host shrinks to 60 % width, the badge's right edge is within 30 px of the new visible box's right edge. |
| | `modal-dialog` | TipTap (`?variant=modal`) | Inside an open `dialog:modal`, a real click on `Ignore here` removes the range. |
| | `sticky-footer` | Textarea | With field 2 under the sticky footer, a badge sits inside the visible box and not under the footer. |
| | `badge-fade` | all | The badge drops to opacity ≤ 0.3 within 500 ms of a keystroke and is back at ≥ 0.95 after 2 s idle. |

## How to get to it (user POV)

- Click into a composer on Gmail, Slack, LinkedIn, X, claude.ai, ChatGPT or Gemini and type. The fixtures stand in for those sites.
- The fixture pages are `rich/<name>.html` on the test page server: `prosemirror`, `tiptap`, `quill`, `draft`, `gmail`, `slate`. `?variant=long` (ProseMirror, Gmail) and `?variant=modal` (TipTap) select the variants.

## Driving it with verify.mjs

Preconditions:

- `V launch` succeeded. It builds the fixtures (`npm run build:fixtures`, into the git-ignored `test-page/rich/`) along with the extension.
- No LanguageTool quota is needed. `V rich-editors` starts `stub-lt` with `test-page/fixtures/lt-replies.json` unless a `stub-lt` is already running, and stops the one it started when it ends.

- **The whole matrix.** Run `V rich-editors`. It prints one line per cell to stderr as it goes, then the matrix and one line per red cell. It exits 1 if any cell is `fail` or `error`. The full run takes about 20 minutes while most cells are red, since each one waits for a range that never comes.
- **One ticket's cells.** Run `V rich-editors --row underline-typing,hover-card --column Quill,Draft`. Both flags take comma-separated names.
- **Evidence.** `log.jsonl` has one `rich-editors <row> <column>` entry per cell, with its result, reason, timing and notes (ranges seen, badge boxes, trial counts, trace numbers), plus every `stub-lt answered` request. `rich-editors.txt` is the printed matrix. `rich-editors/<Column>-<row>.png` is a screenshot at the end of each cell, and `-crop.png` is the native squiggle crop.
- **`error` is not `fail`.** A cell is `error` when the fixture or the driver broke: a missing seed, typed text that did not land, a container that did not scroll. Fix the fixture or the driver, not Type Right.

Debugging a red cell by hand:

1. Open the fixture: `V open http://127.0.0.1:<port>/rich/quill.html`. Use the port from `testPage` in `.verify/run/state.json`. Address it with `--tab rich/quill`.
2. Check the seeds: `V eval "JSON.stringify(fixture.seeds())" --tab rich/quill`.
3. Start the stub if this run has none: `V stub-lt test-page/fixtures/lt-replies.json`.
4. Click into the editor and type: `V type " I will recieve it." --tab rich/quill --selector ".ql-editor p:last-child"`. On Gmail, `--selector` puts the caret at the end of the document, inside the quote. Click the prose instead, as `fixture.typingBlock()` names it.
5. Read our ranges: `V eval "JSON.stringify([...CSS.highlights].map(([name, h]) => [name, [...h].map((r) => r.startContainer.data?.slice(r.startOffset, r.endOffset))]))" --tab rich/quill`.
6. Read the card with `V card`, and the stub's answers in `log.jsonl` (`stub-lt answered`).

## Gotchas

- Underlines are read only from `CSS.highlights` (`type-right-spelling`, `-grammar`, `-wording`, `-translation`), for the Textarea column too. Until textareas move to highlights (#70), the textarea features in `underlines-and-hover-card.md` keep covering them, and most Textarea cells stay red.
- The stub flags every whole-word occurrence of each phrase in `lt-replies.json`, case-sensitively, so `Teh` is not flagged. The fixtures' seeds use these words on purpose. Change both together.
- Each cell reloads its page, so Ignore here and the Apply-refused flag never leak between cells. Settings do: the Dictionary word is removed at the end of its cell, and the Tally cell uses a sentence unique to its column.
- `fixture.bold`, `remoteEdit` and `replaceRoot` act as the site would. Typing, clicks, Ctrl+Z, the mouse and the IME are real CDP input.
- Click, then wait about 150 ms before keys. ProseMirror, TipTap and Slate take the caret from `selectionchange`, so an early key acts on the old selection.
- `apply-timing` stops after its first trial when that trial finds no Apply button, so a red cell costs seconds, not minutes.
