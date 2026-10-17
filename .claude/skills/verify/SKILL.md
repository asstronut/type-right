---
name: verify
description: Drive the real Type Right Chrome extension (built from this checkout) in a throwaway headless Microsoft Edge to prove a change works the way a user sees it. Covers underlines, the Hover card, Ignore here, the Dictionary, the Popup Tally, and the Options page. Use after changing anything under entrypoints/ or lib/, or whenever unit tests are not enough proof. Windows only.
---

# Verify Type Right in a real browser

Type Right is an MV3 extension, so the surface is a web page with the extension's content script in it, plus the extension's own pages (Options, Popup, Consent). The harness is one dependency-free Node script, [`scripts/verify.mjs`](scripts/verify.mjs). It builds the extension, loads `.output/chrome-mv3` unpacked into a headless Edge with a throwaway profile, serves `test-page/` on a free localhost port, and drives everything over CDP with real mouse and keyboard events.

Run every command from the repo root:

```bash
node .claude/skills/verify/scripts/verify.mjs <command> [args]
```

Below, `V` stands for that command. Run `V help` to list every command.

Feature recipes live in [`features/`](features/README.md). Read the index before driving, then follow the matching feature file.

## Why Edge, and Windows only

Branded Google Chrome 137+ ignores `--load-extension`, so it cannot load the unpacked build from the command line. Edge (installed with Windows) still honours it. To use another Chromium that does (Chromium, Chrome for Testing), set `TYPE_RIGHT_BROWSER` to its exe. The script finds Edge in `Program Files (x86)` or `Program Files`.

The script runs on Windows only: it looks for Edge in Windows paths, and cleanup finds leftover browser processes with PowerShell. On anything else, including Linux cloud sessions, `launch` stops before starting anything. There, report the change as not verified in a real browser rather than claiming a proof.

## Launch

```bash
node .claude/skills/verify/scripts/verify.mjs launch
```

What `launch` does:

1. Runs `npm run build`. Launch always rebuilds, because a stale build looks exactly like the pre-fix bug.
2. Starts the test page server, a detached `verify.mjs serve`, on `127.0.0.1:<free port>`.
3. Starts headless Edge with a new profile in `%TEMP%\type-right-verify-*`, CDP on a free port, and the test page as its first tab.

It is ready when the extension's service worker is up and the content script has put an overlay (`[data-type-right-overlay]`) on every textarea of the test page. It then prints `{ ready, testPage, extId, evidenceDir }`.

A fresh profile starts with default Settings:

- LanguageTool at `https://api.languagetool.org`
- LLM provider GLM, no API key, no consent
- empty site lists and Dictionary

The Consent page also opens in its own tab, as on a real install. Nothing needs seeding.

If launch fails partway (for example, timing out while waiting for Edge, the extension or the overlays), it stops whatever it started, keeps the evidence folder and exits 1. It saves each process to the state file as soon as it starts, so a launch killed from outside can still be cleaned up with `cleanup`.

Run state lives in `.verify/run/state.json`. Only one instance per checkout: `launch` refuses if one is already recorded. Separate worktrees each get their own `.verify/`, so they can run side by side. The script never touches your own Chrome or Edge profile.

## Doctor

Run this first whenever anything looks off. It is read-only, and it exits 1 if any check fails.

```bash
node .claude/skills/verify/scripts/verify.mjs doctor
```

It checks:

- the instance is recorded
- the build is newer than every non-test file under `entrypoints/` and `lib/` (if not: `cleanup`, then `launch`)
- the test page is served
- the CDP port belongs to this run's Edge (its command line names our profile)
- the extension service worker answers with its manifest version
- every test page textarea has an overlay
- `api.languagetool.org` is reachable

## Drive

The test page has two textareas: field `0` (plain) and field `1` (short and scrollable). Field-scoped commands take `--field N`, which defaults to 0. Tab-scoped commands take `--tab <url substring | options | popup | consent>`, which defaults to the test page.

| Command | What it does, as a user would |
| --- | --- |
| `type "<text>" [--field N] [--clear]` | Clicks the field and types real keystrokes. `\n` is Enter. `--clear` does Ctrl+A, Backspace first; without it, typing goes to the end. Prints the field value. |
| `slips [--field N] [--wait <text>] [--timeout ms]` | Lists the underlined text and its kind: spelling (red), grammar (blue), wording (purple) or translation (teal). `--wait` polls until `<text>` is underlined. The default timeout is 15 s. |
| `hover "<underlined text>" [--field N]` | Moves the mouse onto the underline and prints the Hover card: kind, type, explanation, suggestions, buttons. |
| `card` | Prints the Hover card open now. |
| `click-card "<button>"` | Real click on a card button: `Show answer`, `Apply <suggestion>` (shown once the answer is open), `Ignore here` or `Add to dictionary`. |
| `keys "<text>" --tab <tab>` | Types real keystrokes into whatever has focus, such as an Options `<input>` focused with `click`. A password field's value is never printed or logged. |
| `press <ArrowDown\|ArrowUp\|Enter\|Escape\|Tab> --tab <tab>` | Presses one named key. To pick a `<select>` option: `click` the select, then `press ArrowDown` and `press Enter`. |
| `value [--field N]` / `badge [--field N]` | The field's value. The LLM badge's label (`LLM` / `LT only`), its tooltip and its color. |
| `open <options\|popup\|consent\|url>` / `close <same>` / `tabs` | Opens a new tab, closes matching tabs, or lists open tabs. |
| `popup` | Opens the real toolbar Popup over the test page. Address it with `--tab popup`. |
| `click "<css selector>" --tab <tab>` | Real mouse click on an element of an extension page (Options and Consent buttons). Scrolls it into view first. |
| `screenshot <name> [--tab <tab>]` | Saves `<name>.png` into the evidence dir. |
| `stub-llm <replies.json>` | Answers the service worker's LLM requests (GLM and Gemini) from a file instead of the Provider, until `cleanup`. The file maps each sentence to the entries the prompt asks the model for (`quote`, `kind`, `type`, `explanation`, `correction`); any other sentence gets none. Each answer is logged with whether the prompt asked for Translation Slips. |
| `eval "<js>" [--tab <tab>]`, `sw-eval "<js>"` | Inspection only: read the page or the service worker, for example `chrome.storage.local.get(null)`. Never use them to cause the behavior under test. |

Stable handles:

- Overlay: `[data-type-right-overlay]`, with one `<span>` per Slip. The kind comes from `text-decoration-color`.
- LLM badge: `[data-type-right-badge]`.
- Hover card: `<type-right-card>`. Its shadow root is closed, so page JS cannot see it; the script reads it through CDP's pierced DOM.
- Options: `form#settings` with `textarea[name=excludedSites]` (field 0) and `textarea[name=disabledSites]` (field 1), plus `button[type=submit]` and `#dictionary`.
- Popup: `#counts`, `#reset`, `#exclude`, `#disable`, `#site`, `#siteHint`.
- Consent: `#accept`, `#decline`.

Use `type` with `--tab options --field N` to fill Options textareas.

## Evidence

Each run writes to `.verify/evidence/<launch timestamp>/`, which is gitignored. That folder holds:

- `log.jsonl`: every command with its printed result. This is the record of each action and the state that followed it.
- `<name>.png`: one per `screenshot`.

A proof needs:

- **The real user path.** Type with keystrokes, hover with the mouse, click buttons, save the Options form. Setting storage or calling internals with `eval` / `sw-eval` is not proof; use them only to read a second view.
- **The action and its result.** For example: `type`, then `slips --wait`, `hover`, `click-card`, `value`, plus a screenshot of the card or field.
- **Side effects through a second view.** Words added to the Dictionary show up in the Options `#dictionary` list. The Tally shows up in Popup `#counts`. Site lists show up in the test page's overlays disappearing, and can be read back with `sw-eval "chrome.storage.local.get(null)"`.
- **Real network.** LanguageTool is the real public API: no mocks. The LLM is exercised either with a key the user has approved for the run, or with `stub-llm` and a dummy key (see [features/llm-check.md](features/llm-check.md)). A stubbed run proves what the extension does with a reply, not what the model replies; `npm run eval:llm` covers that.

## Cleanup

```bash
node .claude/skills/verify/scripts/verify.mjs cleanup
```

Cleanup:

1. Closes Edge over CDP (`Browser.close`).
2. Kills any Edge process whose command line still names this run's profile. It only kills what `launch` started and never kills by process name alone.
3. Kills the test page server by its recorded PID.
4. Deletes the temp profile and `.verify/run/`.

It keeps `.verify/evidence/`. Run it after every run, including failed attempts. Delete old evidence folders by hand when you no longer need them.
