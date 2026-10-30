# Live acceptance pass: Type Right in Rich editors (2026-10-30)

The acceptance gate from #78 (decision #59), run in two passes on the same day.

- **First pass:** the user drove each site in their own Chrome. The agent watched read-only through Claude in Chrome (DOM, page-visible `CSS.highlights`, screenshots). Only sample text was typed, plus a single test character (Z) on some sites. Nothing was sent or posted. On X the agent also attached in-page event listeners to log the caret.
- **Second pass:** at the user's request, the agent drove the user's Chrome through Claude in Chrome: it typed, hovered and clicked, with Chrome DevTools Protocol input, which pages see as trusted. It read the page only through read-only in-page JS: highlight ranges, badge opacity and position, what lies on top of the Hover card. The Popup counts came from the extension's `chrome.storage.local` file on disk, read-only. Only the sample text was typed, with the site's name added to its last sentence (see Tally below), plus blank lines for the scroll check. Every draft was cleared or discarded, and nothing was sent or posted.

- **Extension build:** first pass stack tip `a08a862` (PR #89 on top of #79 to #88). Second pass master `b81a792`, built from the main checkout. Its extension code is identical to `a08a862`.
- **Chrome:** 155.0.8059.85
- **LLM:** the user's own key and consent. The badge showed `LLM` (active) on every site. Provider: Gemini (read from the stored settings in the second pass).

## Verdict

The pass is **complete for the required composers**. Every required composer passes every item, or has an open issue for its failure:

- https://github.com/asstronut/type-right/issues/91: on X, the caret goes back to an old spot after Apply. This is outside checklist item 7, which only asks that the word is fixed.
- https://github.com/asstronut/type-right/issues/92: on claude.ai, Ignore here on "Their" made a second, overlapping Slip appear on the same word. Item 3 fails there. In the second pass the LLM gave "Their" only one Slip on claude.ai, so the overlap did not come up again.

The second pass found no new failures. No site needed "Apply hidden on this site".

Gaps, not run or not recorded:
- Item 4 (Dictionary): "Add to dictionary" was clicked only on Gmail compose (recieve), Slack (seperate) and LinkedIn (tomorow). After that, all three sample spelling words were in the Dictionary, so the other six composers could only show that the added words were not underlined there (they were not). Removal in Options was done once for all three words, at the end, and watched only in the GitHub textarea.
- Gmail reply: items 3, 7, 8 and 9 were taken from compose (same editor and build) and not re-run.
- Apply attempts were fewer than about 3 on Gmail compose (2), Gemini (2) and GitHub (1). The second pass did not re-run Apply.
- Engine package versions are not exposed by most sites. Only Gemini exposes `Quill.version`. See "Engine versions".
- Caret placement after Apply, which is not a checklist item, was inconclusive on ChatGPT and not checked on Gmail, Slack, LinkedIn or the GitHub textarea.
- Gmail Smart Compose: no grey suggestion appeared while the sample was typed in compose or reply, so "never underlined" was not observed. The skip rule is covered by unit tests and the fixture matrix from #89.
- PR #88 trade: site popups were opened on five composers (see "Site popups and the badge"), but none opened over the badge's corner. A popup covering the badge was therefore not observed.
- Clipping on X, and how Gmail's own spelling suggestions look next to ours, were not recorded beyond the notes below.
- Best-effort rows were not run, including Grammarly and LanguageTool coexistence.

## Setup

1. In Chrome, open `chrome://extensions`, turn on Developer mode, and remove or turn off any older Type Right.
2. Load unpacked: `C:\Users\akbar\Dev\2026\type-right\.output\chrome-mv3` (built from master).
3. On the setup page, accept LLM consent and enter your key, or decline to test LanguageTool only.
4. Reload every site tab after loading the build. A tab opened under an older build keeps the old content script.

## Sample text

Type this into each composer, as one paragraph:

```
I will recieve the files tomorow. Their is one seperate task left and it are almost done.
```

`recieve`, `tomorow` and `seperate` should be spelling (red), and `Their is` and `it are` grammar (blue). The LLM may add wording (purple).

The Tally counts each distinct Slip once, keyed by kind, sentence and word. So the same sample on a second site adds nothing. To see a rise on each site, the second pass typed the site's name before the last full stop (for example `...almost done on Slack.`).

## Checklist per composer

| # | Item | Pass when |
|---|---|---|
| 1 | Underlines | Wavy underlines appear under the right words within about 2 s of pausing, and stay on them while you type and scroll |
| 2 | Hover card | Hovering an underline opens the card next to the word, fully in view, with nothing of the site covering it |
| 3 | Ignore here | Ignore here removes that one underline and leaves the others |
| 4 | Dictionary | Add to dictionary removes the word everywhere. Remove it again in Options afterwards |
| 5 | Badge | The LLM badge sits in the composer's bottom-right corner, covers no site control (send, attach, emoji), and fades while you type |
| 6 | Tally | The Popup counts rise for the finished sentences |
| 7 | Apply | Show answer, then Apply: the word is fixed and the underline goes. Wait 1.5 s without typing first |
| 8 | Undo | One Ctrl+Z right after Apply restores the original word |
| 9 | Apply timing | About 3 Apply attempts, all fixed with no "went wrong" note |

A site passes when every item passes. "Apply hidden on this site" counts as a pass for items 7 to 9.

Also watch for:

- A site popup (mention list, emoji picker, toolbar) opening over the badge while you only type. The badge should not stay on top of it. See the trade noted on PR #88.
- Clipping in one-line composers (Slack, X): the card and badge stay readable.
- Gmail: its own spelling suggestions over our underline. Signature, quoted history and the Smart Compose grey text are never underlined.
- Slack: text typed right after a mention chip should still be checked.

## Results

Item 1 now covers scrolling and item 5 the fade on every site. Items 3, 4 and 6 add the second pass's results. Items 7 to 9 are from the first pass.

| Composer | Engine seen | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gmail compose | Gmail custom contenteditable (`div[aria-label="Message Body"]`) | pass | pass | pass | pass | pass | pass | pass | pass | 2 Applies, both accepted | Underlines exact on recieve, tomorow, seperate (spelling) and Their, it are (grammar); signature not underlined; Gmail's dotted grammar line sits under ours. Badge 4/4 px bottom-right, fades to 0.25 on input and returns 1.5 s after the last key. **Second pass:** Tally Spelling 98 → 102, Grammar 29 → 30 (Popup read by the user before and after). Add to dictionary on "recieve" removed its underline at once and left the other four. Scroll: body scrolled 170 px, underlines stayed on their words. Grammar has no Apply by design. |
| Gmail reply | same editor as compose | pass | pass | (as compose) | pass | pass | pass (no rise, by design) | pass | pass | (as compose) | Expanded quoted history (2,746 chars) and signature have zero underlines; typed text underlined exactly. Badge bottom-right above the formatting toolbar, covering nothing. Apply then one Ctrl+Z left "recieve" restored with its underline back. **Second pass:** "recieve", added from compose, is not underlined here. The Tally did not rise because the same sentences were already counted from compose. Fade back after 1506 ms. Page scroll moved the underlines with the text. |
| Slack message | Quill (`.ql-editor`) | pass | pass | pass | pass | pass | pass | pass | pass | pass (3/3: recieve, tomorow, seperate) | One-line box: badge at the right end above Send, covering no control; a long line would run under it. Mention chip is `ts-mention` without contenteditable=false; text typed after it stays outside the chip and is checked ("I recieve it" underlined), the chip itself never flagged (answers the #82 note). **Second pass (self-DM):** Tally Spelling 102 → 104, Grammar 30 → 31, Wording 186 → 187. Add to dictionary on "seperate" removed it. Fade back after 1504 ms. Composer scrolled 59 px, underlines stayed on their words. Red wavy lines under recieve and seperate after they were in the Dictionary are Chrome's own spell check, not ours (our highlights did not include them). |
| LinkedIn post | TipTap / ProseMirror (`.tiptap.ProseMirror`) in a native modal `<dialog>` | pass | pass | pass | pass | pass | pass | pass | pass | pass (3/3) | Badge and card are mounted inside the modal dialog and every card button worked there. The editing host is one line tall, so the badge sits at the right end of the first line; it covers no control, but a long first line runs under it. **Second pass:** Tally Spelling 104 → 105, Grammar 31 → 32, Wording 187 → 188. recieve and seperate not underlined (Dictionary). Add to dictionary on "tomorow" removed it. Fade back after 1514 ms. The editor scrolled and underlines stayed on their words. |
| X post | Draft.js (`.public-DraftEditor-content`) in a `role=dialog` (not a modal `<dialog>`) | pass | pass | pass | pass (not underlined, Add not clicked) | pass | pass | pass | pass | pass (There, tomorrow, receive, separate all applied; one Ctrl+Z restored recieve) | **Caret after Apply:** Draft puts the caret back where its own state last had it, not after the fixed word. Measured: Apply "receive" at offset 7 left the caret at 51, and the next typed Z landed there ("sepzarate"). Apply plus an immediate Enter split "separate" into "sep" / "arate". Text is never corrupted, but the next keystroke can land in an unexpected place. This is outside item 7 and tracked in #91. **Second pass:** Ignore here on "it are" removed only that Slip; "Their" (spelling) and " and" (wording) stayed, and "it are" stayed gone after the next check. Tally Spelling 105 → 106, Grammar 32 → 33, Wording 188 → 189. Fade back after 1502 ms. The dialog scrolled 200 px and underlines stayed on their words. |
| claude.ai | TipTap / ProseMirror (`.tiptap.ProseMirror`) | pass | pass | **fail** (#92) | pass (not underlined, Add not clicked) | pass | pass | pass | pass | pass (3/3: receive, tomorrow, separate) | Badge bottom-right above Send, covering nothing. The caret sits after the fixed word after Apply (the Z landed as "separatez"). Ignore here on the grammar Slip "Their" made a second, overlapping spelling Slip on the same word appear at once. That is most likely how overlapping Slips merge, not a Rich-editor issue: https://github.com/asstronut/type-right/issues/92. **Second pass:** the page restored the first pass's unsent draft; it was cleared before typing. Tally Spelling 106 → 109, Grammar 33 → 35, Wording 189 → 190 (the restored draft's sentence was checked too, so the rise is not all from the new sentence). Fade back after 1506 ms. The page scrolled as the composer grew, and underlines stayed on their words. |
| ChatGPT | ProseMirror (`.ProseMirror`) | pass | pass | pass | pass (not underlined, Add not clicked) | pass | pass | pass | pass | pass (3/3: receive, tomorrow, separate) | Badge bottom-right above Send, covering nothing. Ignore here removed "it are". The caret check is inconclusive: Ignore here came between Apply and the Z, and the Z landed inside "are" ("azre"), most likely where a click on the word left the caret. **Second pass:** a restored first-pass draft was cleared first. Tally Spelling 109 → 112, Grammar 35 → 36, Wording 190 → 192 (includes the restored draft). Fade back after 1501 ms. Composer scrolled; underlines stayed on their words and clipped at its top edge. |
| Gemini | Quill (`.ql-editor`) | pass | pass | pass | pass (not underlined, Add not clicked) | pass | pass | pass | pass | 2 Applies, both accepted | Badge bottom-right above the Send row, covering nothing. Caret check passed: a Z typed 2 s after Apply landed right after the fixed word ("tomorrowz"). Ignore here removed "Their". **Second pass:** Tally Grammar 36 → 38, Wording 192 → 193. Fade back after 1501 ms. Composer scrolled 39 px and back; underlines stayed on their words. |
| GitHub comment (textarea) | `<textarea>` (Primer `prc-Textarea`) | pass | pass | pass | pass (not underlined, Add not clicked) | pass | pass | pass | pass | 1 Apply, accepted | Wavy underlines through `OpaqueRange` highlights, exact on all five Slips. Badge at 18/4 px inside the textarea, clear of the Comment buttons. Apply plus one Ctrl+Z restored "recieve". **Second pass (on #78, not posted):** Ignore here on "it are" removed only that Slip; "Their" and " and" stayed. Tally Grammar 38 → 40, Wording 193 → 194. Fade back after 1503 ms. Page scroll moved the underlines with the text. The textarea grows with its text, so it has no scroll of its own. |

Best-effort rows (non-blocking): Gmail forward, Slack thread and edit, LinkedIn comments and messaging, X DMs, GitHub review comments.

### Dictionary removal

At the end of the second pass, the user removed all three words (recieve, seperate, tomorow) in Options, while the sample sat unposted in the GitHub comment textarea. Each word's underline came back in that open tab within about a second of its removal, with no reload, and the stored Dictionary was empty afterwards.

### Engine versions

Read in the page's own context in the second pass. Most sites bundle their editor without exposing a version.

| Composer | Engine | Version | Root classes |
|---|---|---|---|
| Gmail compose and reply | Gmail's own contenteditable | not exposed | `div[aria-label="Message Body"]` |
| Slack | Quill | not exposed (no `window.Quill`) | `.ql-editor` in `.c-texty_input_unstyled.ql-container` |
| LinkedIn post | TipTap on ProseMirror | not exposed. Its extension list has `history`, which TipTap 3 renamed `undoRedo`, so most likely TipTap 2.x | `div.tiptap.ProseMirror` |
| X post | Draft.js | not exposed | `.public-DraftEditor-content` in `.DraftEditor-editorContainer` in `.DraftEditor-root` |
| claude.ai | TipTap on ProseMirror | not exposed. Its extension list has `undoRedo`, so most likely TipTap 3.x | `div.tiptap.ProseMirror` |
| ChatGPT | ProseMirror (no TipTap editor on the element) | not exposed | `div.ProseMirror` |
| Gemini | Quill | `Quill.version` = 1.3.7 | `.ql-editor.textarea.new-input-ui` |
| GitHub comment | `<textarea>` | not applicable | `textarea.prc-Textarea-TextArea` |

### Badge fade

Measured on every site in the second pass with a read-only observer on the badge's `style.opacity`. The opacity went from 0.85 to 0.25 on the first input and back to 0.85 this long after the last input: Gmail compose 1501 ms, Gmail reply 1506 ms, Slack 1504 ms, LinkedIn 1514 ms, X 1502 ms, claude.ai 1506 ms, ChatGPT 1501 ms, Gemini 1501 ms, GitHub 1503 ms. The code waits 1500 ms.

### Site popups and the badge

Popups opened in the second pass: the emoji picker on Gmail reply, Slack, LinkedIn and X, and the model menu on Gemini. None of them reached the badge's corner, so the badge was never covered and the PR #88 trade (badge stays above a site popup) did not come up. On Slack and X the picker brings a full-page transparent overlay. The badge stays above that overlay, as the trade expects, and it hides nothing because the overlay is clear.

### Screenshots

One per required composer was taken, with the Hover card open. On each, the card is fully in view and the top element at its four corners and centre is the card itself, so no site UI lies over it. The badge covers no site control on any of them.

The screenshots are not in the repo: they show the user's inbox, feeds, chat titles and profile. The user keeps them locally.

## Failures

Each failure gets a note and its own issue. The second pass found no new failures.

- **X (Draft.js): the caret is not after the fixed word after Apply.** Apply fixes the word correctly, and one Ctrl+Z undoes it. Afterwards, though, Draft restores its last stored selection instead of leaving the caret after the replacement, so the user's next keystroke lands where the caret was before. Event log from the page: synthetic `beforeinput insertReplacementText` with the selection at offset 7, then a `selectionchange` to a collapsed caret at 51, then the trusted `insertText` "Z" at 51. Severity: minor. No corruption, but surprising. Issue: https://github.com/asstronut/type-right/issues/91.
- **claude.ai: Ignore here on a word with two overlapping Slips shows the second one at once.** The user ignored the blue grammar Slip on "Their", and a red spelling Slip appeared on the same word at once. Issue: https://github.com/asstronut/type-right/issues/92.
