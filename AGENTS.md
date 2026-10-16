## Architecture map

Chrome MV3 extension (WXT, TypeScript, Vitest). Vocabulary: `GLOSSARY.md`. Details: README "Architecture".

- `entrypoints/content/`: per-page. `index.ts` wires the page to the browser; `page.ts` attaches to textareas and removes Type Right from the page once the extension reloads; `field-overlay.ts` draws underlines and the LLM badge; `hover.ts` + `hover-card.ts` handle the Hover card.
- `lib/checker.ts`: per-Field core, connecting the parts below (per-Engine gate, paragraph re-check, Finished-sentence LLM check + per-Provider sentence cache, back-off amounts, Tally reporting). Tests in `checker.test.ts`, through the public interface only.
- `lib/slip-tracker.ts`: pure Slip state of a Field (text, both Engines' Slips, dirty span, version; edit following, LT/LLM merge, Dictionary predicate, Ignore here). Tests in `slip-tracker.test.ts`.
- `lib/check-scheduler.ts`: debounce + single-flight + back-off, one per Engine; blind to why it is blocked.
- `entrypoints/background.ts`: runs the Engines (all network calls, API key stays here) and serializes Tally writes.
- `lib/engine.ts`, `lib/engines/{language-tool,llm}.ts`, `lib/llm-providers.ts`: the Engine interface, adapters and Provider configs.
- `lib/llm-gate.ts` (background: shared LLM failure pause, refuses checks while paused; the only place that knows a failure's Provider and key) and `lib/llm-health.ts` (content script: the page's LLM health, which every Field's badge and the checker read; it learns failures from the gate through a link). `lib/llm-test-wiring.ts` builds that link around a real gate for tests.
- `lib/settings.ts` (Settings shape, site lists, provider-change rules, `llmPermission`: whether text on a site may go to the LLM, or why not) and `lib/store.ts` (`chrome.storage.local`).
- `lib/slips.ts` (`Slip`, stable ids), `lib/slip-tally.ts` (Tally), `lib/messages.ts` (content↔background messages).
- `entrypoints/{popup,options,consent}/`: extension pages.
- `eval/llm/`: on-demand LLM prompt eval against the real API (`npm run eval:llm`). `run.ts` (the API run) is not part of `npm test`; `score.test.ts` (scoring, no network) is.

Flow: textarea edit → checker → message → background → Engine → `Slip[]` → overlay.

Verify with `npm test` and `npm run compile`.

## Agent skills

### Issue tracker

Issues tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
