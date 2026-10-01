# Type Right

Personal Chrome extension that checks your English as you type, in any `<textarea>`, with no "check" button. It underlines each error in place, colored by kind. The goal is to **learn**, not to be auto-corrected: for each error you'll see what kind it is and why it's wrong, and you fix it yourself.

Full v1 spec: [issue #1](https://github.com/asstronut/type-right/issues/1).

> Status: early (v0.1.0), Chrome / Edge, unpacked install only. Only the LanguageTool engine is built so far.

## How it will work (v1)

- **Underlines by kind:** spelling (red), grammar (blue), unnatural wording (purple).
- **Hover card** (~300 ms): error type, short explanation in simple English, corrected text hidden behind "Show answer". "Apply" only for spelling; grammar and wording you retype.
- **Two engines:**
  - [LanguageTool](https://languagetool.org) (free public API): fast spelling and grammar underlines after you pause.
  - **GLM** (`glm-4.7-flash`, Zhipu AI / Z.ai): runs on finished sentences, catches unnatural wording, better explanations.
- **Privacy controls:** consent at install before any LLM call, an "LLM" badge on every field sent to the LLM, per-site exclusion list (LanguageTool only on those sites).
- **Extras:** ignore once, personal dictionary, popup with error counts per type, US/UK English, configurable LanguageTool URL.

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

## Architecture

```
content script ──check-field msg──▶ background worker ──POST /v2/check──▶ LanguageTool
 (textarea + overlay + checker)      (Engine → CheckError[])
```

Network calls run in the background service worker so API keys never reach page scripts and page CSP doesn't matter.

- `entrypoints/content/`: attaches to textareas, renders underline overlays ([field-overlay.ts](entrypoints/content/field-overlay.ts)).
- `entrypoints/background.ts`: receives text via message, calls the engine.
- `lib/checker.ts`: per-field checker core: edit diffing, offset mapping, paragraph scoping, debounce, rate-limit retry. Tested in [checker.test.ts](lib/checker.test.ts).
- `lib/engine.ts`, `lib/engines/language-tool.ts`: `Engine` interface and the LanguageTool adapter.
- `lib/errors.ts`: `CheckError` shape and stable error ids (derived from kind + flagged text, not position, so re-flagging the same mistake yields the same id).

## Privacy

Text in your textareas is sent to the public LanguageTool API (`https://api.languagetool.org`). The extension requests host permission for that origin only. Once the GLM engine lands, text will also go to Zhipu AI (a Chinese provider) after you consent, except on excluded sites. Password fields and non-text inputs are never checked.

## Security note

v1 has no backend: the GLM API key will live in extension storage, which is fine for a personal unpacked build. If you ever distribute the extension, put the LLM call behind a small proxy first, or the key is exposed.

## Limits

- LanguageTool free tier (as of this project created): 20 requests/min, 20k chars/request, 75k chars/min, no SLA. The checker debounces (600 ms) and re-checks only the edited paragraph.
- `<textarea>` only for now; English (`en-US`) only.
