Closes #
<!-- Stacked PR? Add: "Stacked on #__; merge that first, then retarget to `master`." -->

## Summary
<!-- One line on what changed, then the smallest visual that makes it clear: pseudocode, call tree, file tree, Mermaid, or a diff of one of those. Small change: one bullet per change, naming the file in backticks. Use GLOSSARY.md terms. Examples: the `pr` skill in mattpocock-skills. -->

## Evidence
<!-- Before/after. Screenshot if the change is visual; otherwise the test that now passes, as pseudocode with `# before:` notes, plus the `npm test` result. Say what you checked by hand. -->
- **Before:**
  **After:**

## Merge Danger
**Door:** <!-- one-way (hard to undo: stored data, settings shape, permissions) or two-way (a revert undoes it) -->

**Blast Radius:** <!-- one word, then what could break: which Fields, tabs, sites, Engines, Providers -->

## Not done / follow-ups
<!-- Known gaps, manual checks still to do, things left for later issues. Delete if none. -->
-

## Checklist
- [ ] `npm run compile` clean
- [ ] `npm test` passes
- [ ] `npm run build` clean
- [ ] Checked by hand in the browser (or listed above as not done)
- [ ] README / `GLOSSARY.md` / `docs/adr/` updated if behaviour or terms changed
- [ ] Bug form Area options updated if a UI surface, engine or provider was added or removed
