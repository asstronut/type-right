# Live acceptance pass: Type Right in Rich editors (2026-10-30)

The acceptance gate from #78 (decision #59). The user drives each site in their own Chrome; the agent watches read-only through Claude in Chrome (DOM, page-visible `CSS.highlights`, screenshots). Only sample text is typed, nothing is sent or posted, and every draft is discarded.

- **Extension build:** stack tip `a08a862` (PR #89 on top of #79 to #88), built from `.claude/worktrees/live-pass/.output/chrome-mv3`
- **Chrome:** 155.0.8059.85
- **LLM:** the user's own key and consent. The badge showed `LLM` (active) on every site. The Provider was not recorded.

## Verdict

The pass ran on 2026-10-30. On all nine required composers, underlines, the Hover card, the badge, Apply and one-Ctrl+Z undo worked, and no site needed "Apply hidden on this site". The pass is **partial**. #78 stays open for the gaps below.

Failures, each with an issue:
- https://github.com/asstronut/type-right/issues/91: on X, the caret goes back to an old spot after Apply. This is outside checklist item 7, which only asks that the word is fixed.
- https://github.com/asstronut/type-right/issues/92: on claude.ai, Ignore here on "Their" made a second, overlapping Slip appear on the same word. Item 3 fails there.

Gaps, not run or not recorded:
- Item 3 (Ignore here) was not run on X or on the GitHub comment textarea.
- **Scoping choice:** Dictionary (item 4) and Tally (item 6) were run on Gmail only. Tally lives in the background and the Popup. Dictionary removal re-renders each editor, so on the other sites it was not observed.
- "(as compose)" on Gmail reply means the same editor and the same extension build as Gmail compose, so the result was taken from compose, not re-run.
- Apply attempts were fewer than about 3 on Gmail compose (2), Gemini (2) and GitHub (1).
- Engine versions (`Quill.version`, ProseMirror or TipTap package versions) were not captured. Only the editor root classes were.
- No screenshots are attached. Evidence is the page's own DOM and `CSS.highlights` readings, quoted in the notes.
- Caret placement after Apply, which is not a checklist item, was inconclusive on ChatGPT and not checked on Gmail, Slack, LinkedIn or the GitHub textarea.
- Best-effort rows were not run.

## Setup

1. In Chrome, open `chrome://extensions`, turn on Developer mode, and remove or turn off any older Type Right.
2. Load unpacked: `C:\Users\akbar\Dev\2026\type-right\.claude\worktrees\live-pass\.output\chrome-mv3`.
3. On the setup page, accept LLM consent and enter your key, or decline to test LanguageTool only.
4. Reload every site tab after loading the build. A tab opened under an older build keeps the old content script.

## Sample text

Type this into each composer, as one paragraph:

```
I will recieve the files tomorow. Their is one seperate task left and it are almost done.
```

`recieve`, `tomorow` and `seperate` should be spelling (red), and `Their is` and `it are` grammar (blue). The LLM may add wording (purple).

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

| Composer | Engine seen | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gmail compose | Gmail custom contenteditable (`div[aria-label="Message Body"]`) | pass | pass | pass | pass | pass | pass | pass | pass | pass (2/2 spelling Applies accepted) | Underlines exact on recieve, tomorow, seperate (spelling) and Their, it are (grammar); signature not underlined; Gmail's dotted grammar line sits under ours. Badge 4/4 px bottom-right, fades to 0.25 on input and returns 1.5 s after the last key. Popup showed Spelling 7, Grammar 2, Wording 1 (lifetime totals, no baseline taken). Grammar has no Apply by design. |
| Gmail reply | same editor as compose | pass | pass | (as compose) | (as compose) | pass | (as compose) | pass | pass | (as compose) | Expanded quoted history (2,746 chars) and signature have zero underlines; typed text underlined exactly. Badge bottom-right above the formatting toolbar, covering nothing. Apply then one Ctrl+Z left "recieve" restored with its underline back. |
| Slack message | Quill (`.ql-editor`) | pass | pass | pass | not run (Gmail only) | pass | not run (Gmail only) | pass | pass | pass (3/3: recieve, tomorow, seperate) | One-line box: badge at the right end above Send, covering no control; a long line would run under it. Mention chip is `ts-mention` without contenteditable=false; text typed after it stays outside the chip and is checked ("I recieve it" underlined), the chip itself never flagged (answers the #82 note). |
| LinkedIn post | TipTap / ProseMirror (`.tiptap.ProseMirror`) in a native modal `<dialog>` | pass | pass | pass | not run (Gmail only) | pass | not run (Gmail only) | pass | pass | pass (3/3) | Badge and card are mounted inside the modal dialog and every card button worked there. The editing host is one line tall, so the badge sits at the right end of the first line; it covers no control, but a long first line runs under it. |
| X post | Draft.js (`.public-DraftEditor-content`) in a `role=dialog` (not a modal `<dialog>`) | pass | pass | **not run** | not run (Gmail only) | pass | not run (Gmail only) | pass | pass | pass (There, tomorrow, receive, separate all applied; one Ctrl+Z restored recieve) | **Caret after Apply:** Draft puts the caret back where its own state last had it, not after the fixed word. Measured: Apply "receive" at offset 7 left the caret at 51, and the next typed Z landed there ("sepzarate"). Apply plus an immediate Enter split "separate" into "sep" / "arate". Text is never corrupted, but the next keystroke can land in an unexpected place. This is outside item 7 and tracked in #91. |
| claude.ai | TipTap / ProseMirror (`.tiptap.ProseMirror`) | pass | pass | **fail** (#92) | not run (Gmail only) | pass | not run (Gmail only) | pass | pass | pass (3/3: receive, tomorrow, separate) | Badge bottom-right above Send, covering nothing. The caret sits after the fixed word after Apply (the Z landed as "separatez"). Ignore here on the grammar Slip "Their" made a second, overlapping spelling Slip on the same word appear at once. That is most likely how overlapping Slips merge, not a Rich-editor issue: https://github.com/asstronut/type-right/issues/92. |
| ChatGPT | ProseMirror (`.ProseMirror`) | pass | pass | pass | not run (Gmail only) | pass | not run (Gmail only) | pass | pass | pass (3/3: receive, tomorrow, separate) | Badge bottom-right above Send, covering nothing. Ignore here removed "it are". The caret check is inconclusive: Ignore here came between Apply and the Z, and the Z landed inside "are" ("azre"), most likely where a click on the word left the caret. |
| Gemini | Quill (`.ql-editor`) | pass | pass | pass | not run (Gmail only) | pass | not run (Gmail only) | pass | pass | pass (recieve then undo, tomorrow) | Badge bottom-right above the Send row, covering nothing. Caret check passed: a Z typed 2 s after Apply landed right after the fixed word ("tomorrowz"). Ignore here removed "Their". |
| GitHub comment (textarea) | `<textarea>` (Primer `prc-Textarea`) | pass | pass | not run | not run (Gmail only) | pass | not run (Gmail only) | pass | pass | 1 Apply, accepted | Wavy underlines through `OpaqueRange` highlights, exact on all five Slips. Badge at 18/4 px inside the textarea, clear of the Comment buttons. Apply plus one Ctrl+Z restored "recieve". |

Best-effort rows (non-blocking): Gmail forward, Slack thread and edit, LinkedIn comments and messaging, X DMs, GitHub review comments.

## Failures

Each failure gets a note and its own issue. No screenshots were attached in this pass.

- **X (Draft.js): the caret is not after the fixed word after Apply.** Apply fixes the word correctly, and one Ctrl+Z undoes it. Afterwards, though, Draft restores its last stored selection instead of leaving the caret after the replacement, so the user's next keystroke lands where the caret was before. Event log from the page: synthetic `beforeinput insertReplacementText` with the selection at offset 7, then a `selectionchange` to a collapsed caret at 51, then the trusted `insertText` "Z" at 51. Severity: minor. No corruption, but surprising. Issue: https://github.com/asstronut/type-right/issues/91.
- **claude.ai: Ignore here on a word with two overlapping Slips shows the second one at once.** The user ignored the blue grammar Slip on "Their", and a red spelling Slip appeared on the same word at once. Issue: https://github.com/asstronut/type-right/issues/92.
