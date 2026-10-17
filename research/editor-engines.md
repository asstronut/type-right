# How each acceptance-set site builds its Rich editor

Research for issue #51 (parent #50). Researched 2026-10-17 from public sources only; no live DOM was inspected. Vocabulary follows `GLOSSARY.md` (Field, Rich editor, Slip, Finished sentence).

## Confidence scale

- **High**: the library's own source code, or the site's own docs.
- **Medium**: two or more independent, recent (2026) reports from developers who inspected the live page, or one well-maintained open-source project that ships code against the site.
- **Low**: one report, an old report, or my inference from how the library works.

None of the site claims are high. These are closed-source web apps, and no vendor documents its composer DOM. The library facts (how ProseMirror, Quill or Draft.js render a document) are high, because they come from the library source. Each site customizes its schema, so per-site details must be confirmed by live inspection (see "Needs live inspection").

## Answer

| Site | Library | Editable root | Notable DOM quirks | Confidence |
|---|---|---|---|---|
| Gmail | Google-internal, not a public library | `div[contenteditable=true][g_editable=true]` (role=textbox, aria-label "Message Body") inside `.Ap` in the compose element; main document, no iframe, no shadow DOM | Lines as `<div>`, empty line `<div><br></div>`; quoted thread in `.gmail_quote`, signature in `.gmail_signature`; emoji from the picker may be `<img>` | Root: medium. Library and line shape: low |
| Slack | Quill (customized) | `div.ql-editor[contenteditable=true]`, sets `spellcheck="false"`; light DOM | Slack replaced Quill's placeholder with a `ql-placeholder` element; mentions, emoji and code are Slack's own blots | Medium |
| LinkedIn | Post composer: TipTap/ProseMirror (moved off Quill in 2026). Messaging: custom | Post: `div.tiptap.ProseMirror[contenteditable=true][role=textbox]`. Messaging: `div.msg-form__contenteditable[contenteditable=true][role=textbox]` | Post-composer text lives in an outer React state that only updates on trusted input; `<p>` per paragraph | Medium (one contrary report) |
| X | Draft.js | `div.public-DraftEditor-content[contenteditable=true][role=textbox]`, `data-testid="tweetTextarea_0"` on or near it | Block = `div[data-block=true]`; text in `span[data-text=true]`; empty line `<br data-text=true>`; Draft.js turns `spellcheck` off by default | Medium |
| GitHub | None: comment boxes are `<textarea>` (Markdown) | Already a Field today | No Rich editor for prose. Code surfaces may be contenteditable (see below) | Medium-high |
| claude.ai | ProseMirror (TipTap likely, unconfirmed) | `div.ProseMirror[contenteditable=true]`; light DOM | `<p>` per paragraph; ProseMirror sets `translate="no"` and inserts `br.ProseMirror-trailingBreak` | Library: medium. TipTap: low |
| ChatGPT | ProseMirror | `div.ProseMirror[contenteditable=true][role=textbox]` inside a `<form>`; the `#prompt-textarea` id was dropped in the Sept 2026 redesign | Hidden fallback `<textarea>` sits before the real editor; `<p>` per line | Medium |
| Gemini | Quill, inside an Angular `rich-textarea` element | `rich-textarea div.ql-editor.textarea[contenteditable=true][role=textbox]`; `rich-textarea` is a custom element but its editor is reachable from `document.querySelector`, so light DOM | Quill `<p>` per line; Angular form state is bound to it | Medium |

No site was reported to put its composer in an iframe or a shadow root. The closest is Gemini's `rich-textarea` custom element, and its editor is in the light DOM.

**GitHub has no rich prose surface.** Issue, pull request, discussion and release comment boxes are Markdown `<textarea>`s with a toolbar that inserts Markdown. The GitHub docs describe comment fields as GitHub Flavored Markdown with a formatting toolbar and mention no WYSIWYG mode [G1]. Refined GitHub, which ships features against every comment box and was last updated on 2026-10-16, still targets them as `textarea` [G2]. A trap when reading tools: `github-url-detection` names that set of pages `hasRichTextEditor`, but it means "pages with a Markdown comment box" [G3]. Type Right already treats these as Fields. The third-party extensions GitHub Writer (CKEditor 5) and Better Comments for GitHub (ProseMirror) replace the box with a Rich editor, but only for users who install them [G4]. GitHub's web code editor is likely CodeMirror (contenteditable `.cm-content`), but that is code, not prose, and I found no source for it; see "Needs live inspection".

## How each library puts text in the DOM

These come from the library source, so they are high confidence for the library itself. A site can override any of them.

### ProseMirror and TipTap (claude.ai, ChatGPT, LinkedIn post composer)

- **Root**: the editable element gets class `ProseMirror`, `contenteditable` set from `view.editable`, and `translate="no"` unless the site sets it [PM1]. TipTap adds class `tiptap`.
- **Paragraphs**: `<p>` per paragraph in the basic schema [PM2] and in TipTap.
- **Line breaks**: a hard break node renders `<br>` [PM2]. TipTap binds it to Shift-Enter and Mod-Enter [TT3]. Enter starts a new `<p>`. Whether Shift-Enter inserts `<br>` or a new `<p>` is up to each site.
- **Cursor hacks**: ProseMirror adds `img.ProseMirror-separator` and `br.ProseMirror-trailingBreak` at the end of some textblocks so the caret can sit there [PM3]. These are not content; text extraction must skip them.
- **Mentions and other atoms**: any non-text node without its own editable content gets `contenteditable="false"` [PM3]. TipTap's Mention extension renders `<span data-type="mention" data-id data-label>` with the trigger character plus the label as text [TT1]. So a mention is a non-editable island whose `textContent` is e.g. `@Akbar`.
- **Links**: `<a href title>` [PM2]. TipTap's Link adds `target` and `rel`.
- **Inline code and code blocks**: `<code>` mark; code block is `<pre><code>` [PM2]. TipTap adds `class="language-x"` on the `<code>` [TT2].
- **Quotes**: `<blockquote>` wrapping `<p>`s [PM2].
- **Emoji**: no core node. Plain Unicode text unless the site adds a node (TipTap's Emoji extension renders a `span[data-type=emoji]`).

### Quill (Slack, Gemini)

- **Root**: `div.ql-container > div.ql-editor`; `ql-blank` while empty; placeholder in `data-placeholder` on the root [Q1].
- **Paragraphs and lines**: every line is a block blot, `<p>` [Q2]. Quill has no soft line break: Enter and Shift-Enter both start a new `<p>` by default.
- **Line breaks**: the break blot is `<br>` with value `''`; it only holds an empty line open, as `<p><br></p>` [Q3]. A `<br>` in Quill is never a character.
- **Links**: `<a href rel="noopener noreferrer" target="_blank">` [Q4].
- **Inline code**: `<code>` [Q5].
- **Code blocks**: Quill 2 renders `div.ql-code-block-container > div.ql-code-block` per line [Q5]. Quill 1.3 renders one `<pre spellcheck="false">` with lines separated by `\n` [Q6]. Which version Slack and Gemini run is unknown.
- **Quotes**: `<blockquote>` is itself a line block, one per line, not a wrapper [Q7].
- **Mentions and emoji**: not in core; each site adds its own embed blots.
- **Second contenteditable**: Quill 1 adds a hidden `div.ql-clipboard[contenteditable=true][tabindex=-1]` beside the editor to catch paste [Q8]. Attaching to every `[contenteditable]` would pick it up.

### Draft.js (X)

- **Root**: `div.DraftEditor-root > div.DraftEditor-editorContainer > div.public-DraftEditor-content` with `contenteditable`, `role`, `aria-*`, `white-space: pre-wrap`, class `notranslate`, and `spellCheck` off unless the site turns it on [D1].
- **Paragraphs**: each block is `div[data-block=true][data-editor][data-offset-key]` [D2], containing `div.public-DraftStyleDefault-block`, then leaf `span[data-offset-key]`, then `span[data-text=true]` holding the text [D3, D4].
- **Line breaks**: Enter starts a new block. An empty block renders `<br data-text="true">` in place of the text span [D4]. A soft newline stays as `\n` inside the text and shows only because of `pre-wrap`.
- **Mentions, hashtags, links**: entities and decorators. The site's decorator component wraps the leaf spans, so the markup is X's own [D3].
- **Code blocks and quotes**: the default render map uses `<pre>` (wrapped in `pre`) and `<blockquote>` [D5]. X does not appear to expose these in the composer.
- **Emoji**: Draft.js has no emoji support. X renders emoji through its own decorator.
- **Writes**: Draft.js keeps its own state, so writing to the DOM breaks it. Harper hit exactly this on X when applying a suggestion [D6]. Relevant only if Type Right ever offers Apply in a Rich editor.

### Gmail (no public library)

Gmail's editor is Google-internal. InboxSDK, which is maintained against Gmail (last commit 2026-10-16), finds the body as `.Ap [g_editable=true]` inside the compose element and reads it with `innerHTML` and `textContent` [GM1]. That shows the body is in the main document, not an iframe. Forum reports add `aria-label="Message Body"` and classes `Am Al editable` [GM2]. The `<div>`-per-line shape and the `.gmail_quote` and `.gmail_signature` classes match the HTML Gmail sends, and a 2026 Harper proposal lists those two classes for skipping quoted text and signatures [GM3]. That matters for Type Right: replies and forwards put other people's text inside the same Rich editor.

## Per-site sources and notes

**Slack.** Harper's content script special-cases Slack: its comment calls the compose box "Quill-based", says it sets `spellcheck="false"`, and matches it by class `ql-editor` [S1]. A 2026 reimplementation of Slack's composer copies Slack's `ql-placeholder` element [S2]. Slack's 2019 changelog announced the WYSIWYG composer but names no library [S3]. Mentions, channel links, emoji and code formatting are Slack's own blots; their markup is unknown.

**LinkedIn.** Two independent 2026 reports, both from developers who inspected the logged-in page, say the "Start a post" composer is TipTap/ProseMirror: one found `class="tiptap ProseMirror …"` and zero `.ql-editor` anywhere on linkedin.com (2026-09-16) [L1]; the other says the same and adds that LinkedIn only sees text that arrives through trusted `beforeinput` (2026-10-03) [L2]. Messaging is a separate custom `msg-form__contenteditable` [L1]. One DEV post claims the opposite migration (ProseMirror to Quill) without evidence [L3]. Comment boxes were not covered by any source.

**X.** Harper's lint framework has a Draft.js root finder (`public-DraftEditor-content`), and a Harper issue names X and Facebook as its Draft.js editors [D6, H1]. A 2026-10-07 extension PR still calls X's composer "Draft.js-style" [X1]. Automation snippets use `[data-testid="tweetTextarea_0"]`, `[role=textbox]` and `.public-DraftEditor-content` [X2]. X redesigned its DM ("Chat") composer in August 2026; no source names its editor.

**claude.ai.** A ProseMirror forum thread (January 2025) reports claude.ai uses ProseMirror, and its paste behavior matches ProseMirror's [C1]. A 2026 extension targets claude.ai with `div.ProseMirror[contenteditable="true"]`, but says it did not verify against the live DOM [C2]. I found no source for TipTap specifically.

**ChatGPT.** Before September 2026 the composer was a ProseMirror `div#prompt-textarea[contenteditable]`. After the September 2026 redesign, two reports (2026-09-27 and 2026-09-29) find exactly one `div.ProseMirror[contenteditable="true"]`, one `[contenteditable="true"][role="textbox"]`, and no `#prompt-textarea` [CG1, CG2]. A 2026-09-14 PR, checked against the live page, found a hidden fallback `<textarea>` ahead of the visible ProseMirror editor [CG3]. Community reports also say there is one `<p>` per line and that writing `innerHTML` leaves ProseMirror's state empty (low; see [CG3]).

**Gemini.** A Gemini extension last updated 2026-10-08 describes the input as "Angular + Quill" and targets `rich-textarea .ql-editor[contenteditable="true"]`, then `div.ql-editor.textarea[contenteditable="true"]`, then `div.ql-editor[role="textbox"]` [GE1]. A second extension styles `rich-textarea .ql-editor` [GE2].

## What this means for attaching to Rich editors

Implications, not findings; they follow from the facts above.

- Three engines cover the set: ProseMirror (claude.ai, ChatGPT, LinkedIn posts), Quill (Slack, Gemini) and Draft.js (X), plus Gmail's own and LinkedIn messaging's own. A generic `[contenteditable]` walker that treats block elements as line ends and `<br>` as a line break fits all of them, provided it skips the non-content pieces below.
- Skip when extracting text: `contenteditable=false` islands (mentions, ProseMirror atoms), `ProseMirror-separator` / `ProseMirror-trailingBreak`, Quill's `<p><br></p>` placeholder `<br>`, Draft's `<br data-text>` in empty blocks, and Gmail's `.gmail_quote` / `.gmail_signature`.
- Do not attach to: Quill 1's `.ql-clipboard`, ChatGPT's hidden fallback `<textarea>` (it is a real textarea, so today's Field code may already find it; it should be skipped while hidden), and `role=combobox` editors.
- Do not rely on `spellcheck`: Slack and Draft.js set it to false on purpose.
- Where a Finished sentence ends at "a line ended by a line break", the line break is a block boundary in Quill and Draft.js (one block per line) but may be a `<br>` inside a `<p>` in ProseMirror sites.

## Needs live inspection

For the live-DOM capture ticket. Each needs a real, logged-in page.

1. **Gmail**: confirm `.Ap [g_editable=true]` and `role=textbox`; line shape (`<div>` per line vs `<br>`); how picker emoji render (`<img>` with `alt`/`data-emoji`, or text); quote and signature markup in a reply and a forward; whether Smart Compose ghost text sits inside the editable root.
2. **Slack**: Quill 1 or 2 (code block as `<pre>` or `div.ql-code-block`); markup of user mentions, channel links, emoji, inline code and quotes; whether `.ql-clipboard` exists; whether threads and message edit use the same editor.
3. **LinkedIn**: confirm TipTap in the post composer; mention markup; comment box editor; messaging editor line shape.
4. **X**: confirm Draft.js is still current; mention, hashtag, link and emoji decorator markup; whether `spellcheck` is on; the DM ("Chat") composer's editor.
5. **GitHub**: confirm comment boxes in issues, pull requests (including review comments) and discussions are all `<textarea>`; check whether Copilot Chat on github.com and the web file editor are contenteditable.
6. **claude.ai**: confirm ProseMirror and whether it is TipTap (`.tiptap` class, `p.is-editor-empty[data-placeholder]`); what Shift-Enter inserts; how a pasted code block or file chip renders.
7. **ChatGPT**: confirm the post-redesign root and the hidden `<textarea>`; what Shift-Enter inserts; whether the composer renders Markdown (code, lists) as nodes.
8. **Gemini**: confirm Quill and its version; `rich-textarea` has no shadow root; Shift-Enter behavior.
9. **All sites**: whether the root or an ancestor is `role=textbox` or `role=combobox` (autocomplete); whether any site keeps the composer in an iframe on some surface (for example Gmail pop-out).

## Sources

Library source (high):

- [PM1] ProseMirror view root attributes: https://github.com/ProseMirror/prosemirror-view/blob/master/src/index.ts (`attrs.class = "ProseMirror"`, `contenteditable`, `translate = "no"`)
- [PM2] ProseMirror basic schema `toDOM`: https://github.com/ProseMirror/prosemirror-schema-basic/blob/master/src/schema-basic.ts
- [PM3] ProseMirror view descriptions (`contentEditable = "false"` on non-text leaves, `ProseMirror-separator`, `ProseMirror-trailingBreak`): https://github.com/ProseMirror/prosemirror-view/blob/master/src/viewdesc.ts
- [TT1] TipTap Mention: https://github.com/ueberdosis/tiptap/blob/main/packages/extension-mention/src/mention.ts
- [TT2] TipTap CodeBlock: https://github.com/ueberdosis/tiptap/blob/main/packages/extension-code-block/src/code-block.ts
- [TT3] TipTap HardBreak: https://github.com/ueberdosis/tiptap/blob/main/packages/extension-hard-break/src/hard-break.ts
- [Q1] Quill 2 core (`ql-container`, `ql-editor`, `ql-blank`, `data-placeholder`): https://github.com/slab/quill/blob/main/packages/quill/src/core/quill.ts
- [Q2] Quill block blot (`P`): https://github.com/slab/quill/blob/main/packages/quill/src/blots/block.ts
- [Q3] Quill break blot (`BR`, value `''`): https://github.com/slab/quill/blob/main/packages/quill/src/blots/break.ts
- [Q4] Quill link: https://github.com/slab/quill/blob/main/packages/quill/src/formats/link.ts
- [Q5] Quill 2 code and code block: https://github.com/slab/quill/blob/main/packages/quill/src/formats/code.ts
- [Q6] Quill 1.3.7 code block (`PRE`, `spellcheck=false`): https://github.com/slab/quill/blob/v1.3.7/formats/code.js
- [Q7] Quill blockquote: https://github.com/slab/quill/blob/main/packages/quill/src/formats/blockquote.ts
- [Q8] Quill 1.3.7 clipboard (`ql-clipboard`, `contenteditable`): https://github.com/slab/quill/blob/v1.3.7/modules/clipboard.js
- [D1] Draft.js editor root: https://github.com/facebookarchive/draft-js/blob/main/src/component/base/DraftEditor.react.js
- [D2] Draft.js contents (`data-block`, `data-editor`): https://github.com/facebookarchive/draft-js/blob/main/src/component/contents/DraftEditorContents-core.react.js
- [D3] Draft.js block and decorators: https://github.com/facebookarchive/draft-js/blob/main/src/component/contents/DraftEditorBlock.react.js
- [D4] Draft.js text node (`span[data-text]`, `<br data-text>`): https://github.com/facebookarchive/draft-js/blob/main/src/component/contents/DraftEditorTextNode.react.js
- [D5] Draft.js default block render map: https://github.com/facebookarchive/draft-js/blob/main/src/model/immutable/DefaultDraftBlockRenderMap.js

Site evidence (medium or low):

- [G1] GitHub Docs, About writing and formatting on GitHub: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/about-writing-and-formatting-on-github
- [G2] Refined GitHub `fit-textareas` feature: https://github.com/refined-github/refined-github/blob/main/source/features/fit-textareas.tsx
- [G3] `github-url-detection` `hasRichTextEditor`: https://github.com/refined-github/github-url-detection/blob/main/index.ts
- [G4] GitHub Writer: https://github.com/ckeditor/github-writer ; Better Comments for GitHub: https://github.com/riccardoperra/better-comments-for-github
- [GM1] InboxSDK `getMaybeBodyElement`: https://github.com/InboxSDK/InboxSDK/blob/main/src/platform-implementation-js/dom-driver/gmail/views/gmail-compose-view.ts
- [GM2] Keyboard Maestro forum, Gmail body selector: https://forum.keyboardmaestro.com/t/javascript-to-fill-in-gmail-body-with-variable/9364 ; UiPath forum: https://forum.uipath.com/t/new-email-body-gmail/1281
- [GM3] Harper issue #4510 (quoted text and signatures): https://github.com/Automattic/harper/issues/4510
- [S1] Harper content script, Slack/Quill comment: https://github.com/Automattic/harper/blob/master/packages/chrome-plugin/src/contentScript/index.ts
- [S2] block-kit PR #89 (Slack `ql-placeholder`): https://github.com/nkootstra/block-kit/pull/89
- [S3] Slack changelog, WYSIWYG (2019): https://docs.slack.dev/changelog/2019/09/01/what-they-see-is-what-you-get-and-more-and-less
- [L1] caption-craft PR #20 (2026-09-16): https://github.com/adityakmr7/caption-craft/pull/20
- [L2] signals issue #531 (2026-10-03): https://github.com/therealtimex/signals/issues/531
- [L3] DEV post claiming ProseMirror to Quill: https://dev.to/achiya-automation/linkedin-quietly-migrated-from-prosemirror-to-quill-and-broke-every-browser-automation-tool-that-4927
- [H1] Harper lint framework editor root finders (Draft, ProseMirror, Quill, Lexical, Slate): https://github.com/Automattic/harper/blob/master/packages/lint-framework/src/lint/editorUtils.ts
- [D6] Harper issue #2494 (Draft.js on X and Facebook): https://github.com/Automattic/harper/issues/2494
- [X1] tweetpilot PR #4 (2026-10-07): https://github.com/vtrravikumar/tweetpilot/pull/4
- [X2] WebMCP Twitter tool selectors: https://www.worldbook.it.com/webmcp/twitter
- [C1] discuss.ProseMirror, "Claude.ai home page uses prosemirror" (2025-01-11): https://discuss.prosemirror.net/t/claude-ai-home-page-uses-prosemirror/8092
- [C2] quibble PR #2 (2026-06-14, unverified selectors): https://github.com/mykytaabramenko/quibble/pull/2
- [CG1] orchestrator-pack issue #2168 (2026-09-27): https://github.com/chetwerikoff/orchestrator-pack/issues/2168
- [CG2] image-use issue #41 (2026-09-29): https://github.com/leeguooooo/image-use/issues/41
- [CG3] devspace PR #145 (2026-09-14, hidden fallback textarea before the visible ProseMirror composer, verified with a live CDP probe): https://github.com/James3014/devspace/pull/145 . The `<p>`-per-line and `innerHTML` claims come from search summaries of community PRs I could not open (the ego-chat repo returns 404), so treat them as low.
- [GE1] gemini-automation (2026-10-08): https://github.com/aminurdev/gemini-automation
- [GE2] gemini-custom-extension: https://github.com/tayohei/gemini-custom-extension
