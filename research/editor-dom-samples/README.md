# Live Rich-editor DOM samples from the acceptance set

Answers [#54](https://github.com/asstronut/type-right/issues/54). Captured 2026-10-18 in the user's signed-in Chrome through Claude in Chrome, read-only. The user typed the sample text, and the agent only read the DOM with [`capture.js`](capture.js). Nothing was sent or posted.

The samples:

- [Gmail](gmail.md)
- [Slack](slack.md)
- [LinkedIn](linkedin.md)
- [X](x.md)
- [GitHub](github.md)
- [claude.ai](claude-ai.md)
- [ChatGPT](chatgpt.md)
- [Gemini](gemini.md)

Each sample records the editable root, its six nearest ancestors, every editable on the page, any shadow hosts and iframes, the root's `innerText` and `textContent`, and its `outerHTML`.

**Redaction:** query strings, `data:` URIs and long upper-case IDs became `…` or `<id>`, and attribute values were cut at 80 characters. Real people's names became Dana (Slack), Jane Doe (LinkedIn) and Sender Name (Gmail signature).

**Capture limits:** Claude in Chrome blocks tool output that looks like `key=value` data and cuts output at about 1,000 characters. `capture.js` therefore swaps `=`, `&` and `?` for lookalike characters and is read back in chunks. The saved files have the real characters restored.

## What the samples settle

| Site | Engine (confirmed) | Editable root | Skip | `spellcheck` |
|---|---|---|---|---|
| Gmail | custom | `div[g_editable=true][role=textbox]`, `aria-label="Message Body"` | hidden `textarea#:ta` with the same label; hidden "Ask Gemini" `[role=combobox]` editable; `.gmail_signature_prefix` and `.gmail_signature` *inside* the root | `false` |
| Slack | Quill | `div.ql-editor[role=textbox]`, `data-qa=texty_input` | hidden `div.ql-clipboard[contenteditable]` | `true` |
| LinkedIn post | TipTap (`tiptap ProseMirror`) | `div.tiptap.ProseMirror[role=textbox]`, `componentkey=ShareBox_textEditor` | none | not set |
| X | Draft.js | `div.public-DraftEditor-content[role=textbox]`, `data-testid=tweetTextarea_0` | the second, home-timeline composer behind the dialog (same `data-testid`, also visible) | `true` |
| GitHub | none: `<textarea>` | Primer `textarea` | none | not set |
| claude.ai | TipTap (`tiptap ProseMirror`) | `div.tiptap.ProseMirror[role=textbox]`, `data-testid=chat-input` | hidden, disabled `textarea#static-composer-input` | not set |
| ChatGPT | ProseMirror (no `tiptap` class) | `div.ProseMirror[role=textbox]`, `aria-label="Ask ChatGPT"` | none: no fallback `<textarea>` any more | `true` |
| Gemini | Quill in `<rich-textarea>` | `div.ql-editor.textarea[role=textbox]` | hidden `div.ql-clipboard[contenteditable]` | not set |

1. **No composer sits in a shadow root or an iframe.** Every editable root is in the main document's light DOM. LinkedIn and ChatGPT have shadow hosts, and Gmail, LinkedIn, claude.ai and Gemini have iframes, but none of them holds the composer. This confirms the #51 research.
2. **Every editable root is `role=textbox`.** The only `combobox` is Gmail's hidden "Ask Gemini" box. Pick the visible root that has focus, not just any `[contenteditable]`: Gmail, Slack, claude.ai, Gemini and X all have hidden or duplicate editables.
3. **`innerText` is no usable text model.** One empty paragraph between two others becomes five `\n` in Quill and TipTap (Slack, Gemini, claude.ai) and three in Draft.js (X). `textContent` drops block boundaries altogether. Type Right needs its own DOM-to-text walk that puts a single `\n` between blocks.
4. **Paragraph shape:**
   - Quill and ProseMirror: one `<p>` per paragraph, with `<p><br></p>` as an empty line. TipTap marks that `<br>` with `ProseMirror-trailingBreak`.
   - Draft.js: `div[data-block]` > `div` > `span[data-offset-key]` > `span[data-text]`, with `<br data-text="true">` as an empty block.
   - Gmail mixes shapes inside one root: the first line is wrapped in `div.gmail_default > span`, later lines are bare text nodes split by `<br>`, and an empty `<div><br></div>` follows.
   - ChatGPT's sample was pasted, so it shows `<br>` inside one `<p>` (`data-prompt-literal-paste`). Typed text was not captured there.
5. **Mentions:**
   - Real chips appear only on Slack (`<ts-mention spellcheck=false>`) and LinkedIn (`span[data-type=mention][contenteditable=false] > strong`).
   - On X, `@team` is just colored decorator spans inside the Draft.js text.
   - Everywhere else, the `@name` stayed plain text because no autocomplete was picked.
   - Chips need excluding from checks, because they are names.
6. **Emoji:**
   - Slack: `<img class=emoji data-stringify-text=":…:">`, with a U+FEFF on each side in `textContent`.
   - Gmail: `<img data-emoji="✅" alt="✅">`, which leaves no character in the text at all.
   - X: the Unicode character inside spans that carry a background image.
   - Everyone else: plain Unicode.
   - An image emoji has to count as one placeholder character, or offsets drift.
7. **Links:**
   - claude.ai: auto-links to a real `<a>`.
   - ChatGPT: wraps the URL in an inline-mention chip that holds a `contenteditable=false` icon widget. This makes `innerText` gain a stray `\n`.
   - X: colours the URL span.
   - The rest: leave it as text.
8. **Inline code:** only Slack turned backticks into `<code>`. All other sites kept literal backticks in the text.
9. **Gmail specifics:**
   - The body sets `spellcheck="false"`, so the browser draws no native squiggles there.
   - The text starts with a U+200B.
   - The signature lives inside the editable root.
10. **Grammarly opt-out:** Slack and Gemini set `data-gramm="false"`. `translate="no"` or `notranslate` is on claude.ai, ChatGPT, LinkedIn and X.

## Still not covered

These need another live pass:

- Typed Shift+Enter vs Enter, compared side by side.
- Blockquotes: every quote in the samples was typed inline.
- Code blocks.
- Gmail reply and forward quotes, and Smart Compose ghost text.
- Slack thread and edit composers.
- LinkedIn comment and messaging boxes.
- X DMs.
- GitHub Copilot Chat and review comments.
- Typed (not pasted) text in ChatGPT.
