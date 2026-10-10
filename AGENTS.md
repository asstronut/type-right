## Architecture map

Chrome MV3 extension (WXT, TypeScript, Vitest). Vocabulary: `GLOSSARY.md`. Details: README "Architecture".

- `entrypoints/content/`: per-page. `index.ts` attaches to textareas; `field-overlay.ts` draws underlines and the LLM badge; `hover.ts` + `hover-card.ts` handle the Hover card.
- `lib/checker.ts`: per-Field core (edit diff, paragraph re-check, Finished-sentence LLM scheduling + cache, LT/LLM merge, Ignore here, Tally reporting). Biggest file; tests in `checker.test.ts`.
- `entrypoints/background.ts`: runs the Engines (all network calls, API key stays here) and serializes Tally writes.
- `lib/engine.ts`, `lib/engines/{language-tool,llm}.ts`, `lib/llm-providers.ts`: the Engine interface, adapters and Provider configs.
- `lib/llm-gate.ts` (background: shared LLM failure pause, refuses checks while paused) and `lib/llm-failure.ts` (the tab's shared failure, which every Field's LLM health reads).
- `lib/settings.ts` (Settings shape, site lists, provider-change rules) and `lib/store.ts` (`chrome.storage.local`).
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
