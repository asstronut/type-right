# Type Right

Personal Chrome extension that checks your English as you type, in any `<textarea>`, with no "check" button. It underlines each error in place, colored by kind. The goal is to **learn**, not to be auto-corrected: for each error you'll see what kind it is and why it's wrong, and you fix it yourself.

Full v1 spec: [issue #1](https://github.com/asstronut/type-right/issues/1).

> Status: early (v0.1.0), Chrome / Edge, unpacked install only. LanguageTool and GLM engines both run.

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
content script ──check-field msg────▶ background worker ──POST /v2/check──────────▶ LanguageTool
 (textarea + overlay + checker) ─check-sentence msg─▶ (Engine → CheckError[]) ──POST chat/completions──▶ GLM (Z.ai)
```

Network calls run in the background service worker so API keys never reach page scripts and page CSP doesn't matter.

- `entrypoints/content/`: attaches to textareas, renders underline overlays ([field-overlay.ts](entrypoints/content/field-overlay.ts)).
- `entrypoints/background.ts`: receives text via message, calls the engine with the current Settings (English variant, LanguageTool URL).
- `entrypoints/options/`: Options page (right-click the extension icon → Options).
- `entrypoints/consent/`: Consent page, opened on install; no LLM calls until the user accepts.
- `lib/settings.ts`, `lib/store.ts`: `Settings` shape, defaults, site-list matching, and the typed Store over `chrome.storage.local`. Tested in [settings.test.ts](lib/settings.test.ts).
- `lib/checker.ts`: per-field checker core: edit diffing, offset mapping, paragraph scoping, debounce, rate-limit retry, LLM sentence scheduling (complete sentences only, ~1.5 s pause, cached by sentence text) and merging of overlapping LanguageTool/LLM Errors. Tested in [checker.test.ts](lib/checker.test.ts).
- `lib/engine.ts`, `lib/engines/language-tool.ts`, `lib/engines/glm.ts`: `Engine` interface, the LanguageTool adapter, and the GLM adapter (prompt, JSON reply parsing, locating quoted spans, falling back to `glm-4.5-flash` when `glm-4.7-flash` is overloaded).
- `lib/errors.ts`: `CheckError` shape and stable error ids (derived from kind + flagged text, not position, so re-flagging the same mistake yields the same id).

## Privacy

Text in your textareas is sent to the public LanguageTool API (`https://api.languagetool.org`). The extension requests host permission for that origin only; pointing it at another LanguageTool server on the Options page asks for permission to that host. Sites on the "Turn Type Right off" list get no checking at all. Finished sentences also go to Zhipu AI / Z.ai (a Chinese provider), only after you accept on the Consent page (shown on install; changeable in Options) and set an API key, and never on sites in the "Never send to the LLM" list. Password fields and non-text inputs are never checked.

## Security note

v1 has no backend: the GLM API key lives in extension storage, which is fine for a personal unpacked build. If you ever distribute the extension, put the LLM call behind a small proxy first, or the key is exposed.

## Limits

- LanguageTool free tier (as of this project created): 20 requests/min, 20k chars/request, 75k chars/min, no SLA. The checker debounces (600 ms) and re-checks only the edited paragraph.
- `<textarea>` only for now; US or UK English.
