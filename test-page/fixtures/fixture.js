/**
 * What every Rich editor fixture page puts on `window.fixture`, for `V rich-editors` to read and
 * set up cells with. The runner drives the user's part (clicks, keys, the mouse) itself; these
 * hooks only read the page or act as the site would (a collaborator's edit, a rebuilt editor).
 *
 * @typedef {'ProseMirror' | 'TipTap' | 'Quill' | 'Draft' | 'Gmail' | 'Slate'} Column
 * @typedef {'default' | 'long' | 'modal'} Variant
 * @typedef {{ name: string, ok: boolean, detail?: string }} SeedCheck
 * @typedef {{ name: string, element: Element, poke: 'none' | 'click' | 'paste' }} Decoy
 *
 * @typedef {object} Fixture
 * @property {Column} column
 * @property {Variant} variant From `?variant=` in the page URL.
 * @property {{ name: string, version: string }} library The installed package's own version.
 * @property {() => HTMLElement} host The editing host the user types into (a new element after `replaceRoot`).
 * @property {() => string} text The editor's own model text, blocks joined by `\n`.
 * @property {() => SeedCheck[]} seeds One check per seed of this column and variant, read from the live DOM.
 * @property {() => Element} typingBlock The block whose end is where the user types (before Gmail's signature).
 * @property {() => Element[]} notChecked Seeded regions that must never get a Slip.
 * @property {() => Element[]} neverFlag Seeded chips, image emoji and inline code.
 * @property {() => Decoy[]} decoys Editables that must never become a Field.
 * @property {(word: string) => void} bold Bolds the last occurrence of `word` through the library.
 * @property {(text: string) => void} remoteEdit Inserts `text` as a new first paragraph through the library, without focus.
 * @property {() => HTMLElement} replaceRoot Destroys the editor and mounts a new one with the same content.
 * @property {() => HTMLElement} scroller The host's scroll container.
 * @property {() => HTMLElement} otherScroller A scroll container unrelated to the host.
 */

/** @param {Fixture} fixture */
export function expose(fixture) {
  window.fixture = fixture;
  document.documentElement.dataset.fixtureReady = 'true';
}
