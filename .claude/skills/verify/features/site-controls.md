# Site controls

A user can turn Type Right off on a site, which means no checking and no overlay at all. They can also keep a site's text away from the LLM, so only LanguageTool checks it. The lists can be changed from the Popup's buttons for the current tab, or as one site per line on the Options page.

## Sub-features

- `site-disable` stops all checking on a listed site, and removes overlays from pages already open.
- `site-exclude` keeps the LLM off a listed site. The badge reads `LT only` with the "excluded from the LLM" tooltip.
- `site-popup-buttons` shows `Exclude this site from LLM` and `Turn off on this site` for the current tab in the Popup.

## How to get to it (user POV)

- Options page: the "Never send to the LLM" and "Turn Type Right off" textareas, then `Save`.
- Toolbar Popup over a page: the two site buttons.

## Driving it with verify.mjs

Preconditions:

- Baseline from the index. The test page's host is `127.0.0.1`.

- **Disable via Options.** Run `V open options`, `V type "127.0.0.1" --tab options --field 1` and `V click 'button[type=submit]' --tab options`.
- **Observe the page.** Run `V eval "document.querySelectorAll('[data-type-right-overlay]').length"`. It prints `0`. Then run `V type "I will recieve it." --clear --field 1`, wait 4 s, and run `V slips --field 1`. It prints `[]`.
- **Second view.** Run `V sw-eval "chrome.storage.local.get(null).then(s => JSON.stringify(s.settings.disabledSites))"`. It prints `["127.0.0.1"]`.
- **Exclude from LLM.** Same steps with field 0 (`excludedSites`). The badge then reads `LT only`, with a tooltip that says the site is excluded from the LLM (`V badge`).

## Gotchas

- `site-popup-buttons` cannot be driven here. The Popup reads the current tab through the `activeTab` permission, which only a real toolbar click grants. `V popup` (`chrome.action.openPopup()`) and `V open popup` both show `This page`, `Type Right does not run on this page.` and disabled buttons. Report this sub-feature as not verified, and drive the lists through Options.
- On a disabled site, `slips` prints `[]` because there is no overlay at all. Check the overlay count, not just the empty list.
- `site-exclude` has not been driven yet. Fix these steps once it has been run.
