(() => {
  const clean = (v) => (v.startsWith('data:') ? 'data:…' : v.replace(/[?#].*$/s, '…')).replace(/\b[A-Z0-9]{9,}\b/g, '<id>').slice(0, 80);
  const editableRootOf = (el) => { while (el.parentElement && el.parentElement.isContentEditable) el = el.parentElement; return el; };
  const tagOf = (el) => el.tagName.toLowerCase() + [...el.attributes].map((a) => ` ${a.name}="${clean(a.value)}"`).join('');
  const shadowHosts = new Set();
  const walk = (root) => { for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { shadowHosts.add(el.tagName.toLowerCase()); walk(el.shadowRoot); } };
  walk(document);
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  const root = active && (active.isContentEditable ? editableRootOf(active) : active.tagName === 'TEXTAREA' ? active : null);
  const editables = [...new Set([...document.querySelectorAll('[contenteditable]:not([contenteditable="false"]), textarea')].map((e) => (e.isContentEditable ? editableRootOf(e) : e)))]
    .map((e) => `${e === root ? '* ' : '  '}${e.getBoundingClientRect().width > 0 ? 'visible' : 'hidden '} <${tagOf(e)}>`);
  const iframes = [...document.querySelectorAll('iframe')].map((f) => {
    let ce; try { ce = f.contentDocument ? f.contentDocument.querySelectorAll('[contenteditable]').length : 'x-origin'; } catch { ce = 'x-origin'; }
    let host = ''; try { host = new URL(f.src).host; } catch {}
    return `${f.getBoundingClientRect().width > 0 ? 'visible' : 'hidden '} ${host || '(no src)'} contenteditables:${ce}`;
  });
  const ancestors = []; for (let p = root && root.parentElement, i = 0; p && i < 6; p = p.parentElement, i++) ancestors.push(`<${tagOf(p)}>`);
  let html = '';
  if (root) { const c = root.cloneNode(true); for (const n of [c, ...c.querySelectorAll('*')]) for (const a of [...n.attributes]) n.setAttribute(a.name, clean(a.value)); html = c.outerHTML; }
  const out = [
    '## path', location.host + location.pathname.replace(/[A-Za-z0-9_\-]{8,}/g, '<id>'),
    '## focused root', root ? `<${tagOf(root)}>` : '(none)',
    '## ancestors (nearest first)', ...ancestors,
    '## all editables (* = focused)', ...editables,
    '## shadow hosts', [...shadowHosts].join(', ') || '(none)',
    '## iframes', ...(iframes.length ? iframes : ['(none)']),
    '## innerText', root ? JSON.stringify(root.tagName === 'TEXTAREA' ? root.value : root.innerText) : '',
    '## textContent', root && root.tagName !== 'TEXTAREA' ? JSON.stringify(root.textContent) : '',
    '## outerHTML', html,
  ].join('\n');
  window.__trOut = out.replace(/=/g, '⩴').replace(/&/g, '＆').replace(/\?/g, '¿');
  return window.__trOut.length;
})()
