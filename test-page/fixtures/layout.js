const STYLE = `
  html { background: #fff; }
  body {
    font: 16px/1.5 system-ui, sans-serif;
    color: #1a1a1a;
    background: #fff;
    max-width: 720px;
    margin: 0 auto;
    padding: 16px;
  }
  h1 { font-size: 18px; margin: 0 0 12px; }
  #other-scroller {
    height: 120px;
    overflow-y: auto;
    border: 1px solid #bbb;
    padding: 4px 8px;
    margin-bottom: 16px;
    font-size: 14px;
    box-sizing: content-box;
  }
  .scroller {
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid #888;
    padding: 8px 12px;
    background: #fff;
  }
  .scroller p { margin: 0 0 8px; }
  .scroller pre {
    margin: 8px 0;
    padding: 8px;
    background: #f4f4f5;
    font: 14px/1.4 ui-monospace, Consolas, monospace;
    white-space: pre-wrap;
  }
  .scroller blockquote {
    margin: 8px 0;
    padding-left: 12px;
    border-left: 3px solid #bbb;
    color: #444;
  }
  .scroller code { padding: 0 3px; background: #eee; font: 0.9em ui-monospace, Consolas, monospace; }
  .scroller pre code { padding: 0; background: none; }
  .scroller img.emoji, .scroller img.an1 { width: 1.25em; height: 1.25em; vertical-align: -0.25em; }
  .ProseMirror { outline: none; white-space: pre-wrap; word-wrap: break-word; }
  .ql-container { height: auto; font: inherit; }
  .ql-editor { height: auto; overflow: visible; padding: 0; line-height: inherit; }
  .ql-editor p { margin: 0 0 8px; }
  .ql-editor.ql-blank::before { left: 0; }
`;

export function getVariant() {
  const variant = new URLSearchParams(location.search).get('variant');
  return variant === 'long' || variant === 'modal' ? variant : 'default';
}

export function check(name, ok, detail) {
  return detail === undefined ? { name, ok: Boolean(ok) } : { name, ok: Boolean(ok), detail: String(detail) };
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'text') node.textContent = value;
    else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

export function buildPage(column) {
  document.head.append(el('style', { text: STYLE }));
  const header = el('h1', { text: `Type Right fixture: ${column}` });
  const otherScroller = el(
    'div',
    { id: 'other-scroller' },
    ...Array.from({ length: 40 }, (_, i) => el('div', { text: `Unrelated panel line ${i + 1}: nothing here is editable.` })),
  );
  const mount = el('div', { id: 'editor-mount' });
  const scroller = el('div', { class: 'scroller' }, mount);
  const slot = el('main', { id: 'editor-slot' }, scroller);
  document.body.append(header, otherScroller, slot);
  return { header, otherScroller, scroller, mount, slot };
}

export function remount(oldMount) {
  const mount = el('div', { id: 'editor-mount' });
  oldMount.replaceWith(mount);
  return mount;
}

export function tallerThanScroller(host, scroller) {
  const hostHeight = host.getBoundingClientRect().height;
  return check('host taller than scroller', hostHeight > scroller.clientHeight, `host ${Math.round(hostHeight)} px, scroller ${scroller.clientHeight} px`);
}

export function textboxAttributes(host, spellcheck = 'true') {
  const actual = {
    role: host.getAttribute('role'),
    'aria-multiline': host.getAttribute('aria-multiline'),
    spellcheck: host.getAttribute('spellcheck'),
  };
  const ok = actual.role === 'textbox' && actual['aria-multiline'] === 'true' && actual.spellcheck === spellcheck;
  return check('host is a multi-line textbox', ok, JSON.stringify(actual));
}
