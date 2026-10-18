# PROTOTYPE: underlines in a Rich editor (#57)

Throwaway. Answers https://github.com/asstronut/type-right/issues/57; the verdict is on that issue.

```
cd prototype/rich-editor-underlines
npm install
npm start          # http://localhost:5174
```

- `editor.ts` is "the site": a stock ProseMirror editor, plus buttons that re-render it (mark split, remote edit, same-doc setState, destroy and recreate the view, a 54k-char doc).
- `underlines.ts` is "Type Right": it only gets the contenteditable root. It reads the text, follows edits with the real `lib/slip-tracker.ts`, runs a fake rule-based Engine 500 ms after typing, and paints Slips with `CSS.highlights`. It never writes to the editor's DOM or calls ProseMirror.
- The right-hand panel shows the tracker's text with Slips marked, plus render stats.
