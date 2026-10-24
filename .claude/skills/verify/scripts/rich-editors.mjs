import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const LT_REPLIES = path.join('test-page', 'fixtures', 'lt-replies.json');

const COLUMNS = [
  { name: 'ProseMirror', page: 'rich/prosemirror.html', dictionaryWord: 'blorvik' },
  { name: 'TipTap', page: 'rich/tiptap.html', dictionaryWord: 'snarfle' },
  { name: 'Quill', page: 'rich/quill.html', dictionaryWord: 'quexle' },
  { name: 'Draft', page: 'rich/draft.html', dictionaryWord: 'drabbet' },
  { name: 'Gmail', page: 'rich/gmail.html', dictionaryWord: 'gloomph' },
  { name: 'Slate', page: 'rich/slate.html', dictionaryWord: 'slubber' },
  { name: 'Textarea', page: '', dictionaryWord: 'texxle', textarea: true },
];
const ALL = COLUMNS.map((c) => c.name);
const RICH = ALL.filter((name) => name !== 'Textarea');

const WORD_AFTER_IMAGE_EMOJI = { Quill: 'remaning', Gmail: 'diffrence' };

const SLIP = ' I will recieve it.';
const TIMEOUT_MS = 6000;

class CellFail extends Error {}
class CellPrecondition extends Error {}
const expect = (ok, reason) => { if (!ok) throw new CellFail(reason); };
const pre = (ok, reason) => { if (!ok) throw new CellPrecondition(reason); };

const PAGE_LIB = `(() => {
  const KINDS = ['spelling', 'grammar', 'wording', 'translation'];
  const tr = { target: null };
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, x: r.left + r.width / 2, y: r.top + r.height / 2 });
  tr.host = () => tr.target.textarea ? document.querySelectorAll('textarea')[tr.target.field] : window.fixture.host();
  tr.text = () => tr.target.textarea ? tr.host().value : window.fixture.text();
  tr.regions = () => tr.target.textarea ? { notChecked: [], neverFlag: [], decoys: [] }
    : { notChecked: fixture.notChecked(), neverFlag: fixture.neverFlag(), decoys: fixture.decoys().map((d) => d.element) };
  const live = (r) => {
    if (r instanceof Range) return r;
    if (!(r instanceof StaticRange)) return null;
    try {
      const l = document.createRange();
      l.setStart(r.startContainer, r.startOffset);
      l.setEnd(r.endContainer, r.endOffset);
      return l;
    } catch { return null; }
  };
  const textareaUnder = (rect, host) => {
    const overlaps = (t) => { const b = t.getBoundingClientRect(); return rect.right > b.left && rect.left < b.right && rect.bottom > b.top && rect.top < b.bottom; };
    return (tr.target.textarea && overlaps(host) ? host : [...document.querySelectorAll('textarea')].find(overlaps)) ?? null;
  };
  const touches = (r, l, el) => r.startContainer === el || el.contains(r.startContainer) || (l ? l.intersectsNode(el) : false);
  tr.highlights = () => {
    const host = tr.host();
    const { notChecked, neverFlag, decoys } = tr.regions();
    const out = [];
    for (const kind of KINDS) {
      const h = CSS.highlights.get('type-right-' + kind);
      if (!h) continue;
      for (const r of h) {
        const l = live(r);
        let el = r.startContainer;
        let text = null;
        let rect = null;
        if (l) { text = l.toString(); rect = box(l.getBoundingClientRect()); }
        else if (r.getBoundingClientRect) {
          rect = box(r.getBoundingClientRect());
          el = textareaUnder(rect, host);
          if (el) text = el.value.slice(r.startOffset, r.endOffset);
        }
        out.push({
          kind, text, rect,
          connected: Boolean(el && el.isConnected),
          inHost: Boolean(host && (el === host || host.contains(el))),
          inNotChecked: notChecked.some((e) => touches(r, l, e)),
          inNeverFlag: neverFlag.some((e) => touches(r, l, e)),
          inDecoy: decoys.some((e) => touches(r, l, e)),
        });
      }
    }
    return out;
  };
  const skipped = (node) => tr.regions().notChecked.some((e) => e.contains(node));
  tr.wordRect = (word) => {
    const host = tr.host();
    if (tr.target.textarea) {
      const at = host.value.lastIndexOf(word);
      return at < 0 ? null : box(host.createValueRange(at, at + word.length).getBoundingClientRect());
    }
    let found = null;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (skipped(n)) continue;
      const at = n.data.lastIndexOf(word);
      if (at >= 0) { const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + word.length); found = r; }
    }
    return found && box(found.getBoundingClientRect());
  };
  tr.typedSlip = (word) => {
    const at = tr.wordRect(word);
    return (at && tr.highlights().find((h) => h.inHost && h.connected && !h.inNotChecked && h.text === word && h.rect
      && Math.abs(h.rect.left - at.left) <= 2 && Math.abs(h.rect.top - at.top) <= 2)) ?? null;
  };
  tr.isBold = (word) => {
    const walker = document.createTreeWalker(tr.host(), NodeFilter.SHOW_TEXT);
    let last = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!skipped(n) && n.data.includes(word)) last = n;
    return Boolean(last) && Number(getComputedStyle(last.parentElement).fontWeight) >= 600;
  };
  tr.clickPoint = () => {
    const host = tr.host();
    if (tr.target.textarea) { host.scrollIntoView({ block: 'center' }); return box(host.getBoundingClientRect()); }
    const block = fixture.typingBlock();
    block.scrollIntoView({ block: 'nearest' });
    let last = null;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.replace(/[\\u200b\\ufeff\\s]/g, '') && !n.parentElement.closest('[contenteditable=false]')) last = n;
    if (!last) return box(block.getBoundingClientRect());
    const r = document.createRange();
    r.setStart(last, last.data.length - 1);
    r.setEnd(last, last.data.length);
    const b = box(r.getBoundingClientRect());
    return { ...b, x: b.right - 1 };
  };
  tr.visibleBox = (el) => {
    let b = el.getBoundingClientRect();
    let { left, top, right, bottom } = b;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const c = a.getBoundingClientRect();
      left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
    }
    left = Math.max(left, 0); top = Math.max(top, 0); right = Math.min(right, innerWidth); bottom = Math.min(bottom, innerHeight);
    return right > left && bottom > top ? box({ left, top, right, bottom, width: right - left, height: bottom - top }) : null;
  };
  tr.badges = () => [...document.querySelectorAll('[data-type-right-badge]')].map((b) => {
    const s = getComputedStyle(b);
    const r = box(b.getBoundingClientRect());
    return { label: b.textContent, title: b.title, opacity: Number(s.opacity), rect: r, shown: s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 };
  }).filter((b) => b.shown);
  tr.hostBadge = (el = tr.host()) => {
    const v = tr.visibleBox(el);
    if (!v) return { visibleBox: null, badge: null };
    const inside = tr.badges().filter((b) => b.rect.x >= v.left - 1 && b.rect.x <= v.right + 1 && b.rect.y >= v.top - 1 && b.rect.y <= v.bottom + 1);
    return { visibleBox: v, badge: inside[0] ?? null };
  };
  window.__tr = tr;
})()`;

const ROWS = [
  row('underline-typing', 'Parity checklist', ALL, async (c) => {
    await c.typeAtEnd(SLIP);
    expect(await c.waitSlip('recieve'), 'no type-right-spelling range on "recieve" in the Field');
  }),
  row('underline-scroll', 'Parity checklist', ALL, async (c) => {
    if (c.column.textarea) await c.typeAtEnd('Line one.\nLine two.\nLine three.\nLine four.\nLine five.\nLine six.');
    await c.typeAtEnd(SLIP);
    const before = await c.waitSlip('recieve');
    expect(before, 'no range on "recieve" before scrolling');
    const scroller = c.column.textarea ? '__tr.host()' : 'fixture.scroller()';
    const top0 = await c.js(`${scroller}.scrollTop`);
    await c.wheel(before.rect.x, before.rect.y, top0 > 8 ? -8 : 8);
    const top1 = await c.js(`${scroller}.scrollTop`);
    pre(top1 !== top0, `the Field's container did not scroll (scrollTop ${top0})`);
    await c.sleep(300);
    const after = await c.typedSlip('recieve');
    c.note({ scrolled: top0 - top1, before: before.rect, after: after?.rect, word: await c.js(`__tr.wordRect('recieve')`) });
    expect(after, 'no range on the typed "recieve" (±2 px) after scrolling');
  }),
  row('hover-card', 'Parity checklist', ALL, async (c) => {
    await c.typeAtEnd(SLIP);
    const slip = await c.waitSlip('recieve');
    expect(slip, 'no range on "recieve" to hover');
    const card = await c.hover(slip.rect);
    expect(card, 'no Hover card opened over "recieve"');
    expect(card.kind === 'Spelling' && card.type === 'Spelling mistake', `the card shows ${card.kind} / ${card.type}`);
    const box = card.rect;
    const viewport = await c.js('({ w: innerWidth, h: innerHeight })');
    expect(box.left >= 0 && box.top >= 0 && box.right <= viewport.w && box.bottom <= viewport.h, 'the card is not fully inside the viewport');
    const gap = Math.min(Math.abs(box.top - slip.rect.bottom), Math.abs(slip.rect.top - box.bottom));
    expect(gap <= 40, `the card is ${Math.round(gap)} px from the word`);
  }),
  row('ignore-here', 'Parity checklist', ALL, async (c) => {
    await c.typeAtEnd(`${SLIP} I seen him.`);
    const slip = await c.waitSlip('recieve');
    expect(slip && (await c.waitSlip('seen')), 'no ranges on "recieve" and "seen"');
    expect(await c.hover(slip.rect), 'no Hover card opened');
    expect(await c.clickCard('Ignore here'), 'the card has no "Ignore here" button');
    expect(await c.waitGone('recieve'), '"recieve" is still underlined after Ignore here');
    expect(await c.typedSlip('seen'), 'Ignore here also removed the other Slip');
  }),
  row('dictionary', 'Parity checklist', ALL, async (c) => {
    const word = c.column.dictionaryWord;
    await c.typeAtEnd(` We like the ${word} sound.`);
    const slip = await c.waitSlip(word);
    expect(slip, `no range on "${word}"`);
    expect(await c.hover(slip.rect), 'no Hover card opened');
    expect(await c.clickCard('Add to dictionary'), 'the card has no "Add to dictionary" button');
    expect(await c.waitGone(word), `"${word}" is still underlined after Add to dictionary`);
    expect(await c.dictionaryHas(word, { remove: true }), `the Options page does not list "${word}"`);
  }),
  row('badge', 'Parity checklist', ALL, async (c) => {
    await c.typeAtEnd(SLIP);
    await c.waitSlip('recieve');
    const { visibleBox, badge } = await c.js('__tr.hostBadge()');
    c.note({ visibleBox, badge });
    expect(badge, 'no LLM badge inside the Field\'s visible box');
    expect(['LLM', 'LT only'].includes(badge.label), `the badge reads "${badge.label}"`);
  }),
  row('tally', 'Parity checklist', ALL, async (c) => {
    const before = await c.tally();
    const run = Date.now().toString(36).replace(/\d/g, (d) => 'abcdefghij'[d]);
    await c.typeAtEnd(` The ${c.column.name} tally ${run} will recieve it.`);
    const after = await c.until(async () => {
      const now = await c.tally();
      return (now.Spelling ?? 0) > (before.Spelling ?? 0) && now;
    }, 10000);
    c.note({ before, after });
    expect(after, 'the Popup Tally did not count the finished Slip');
  }),
  row('not-checked', 'Parity checklist', RICH, async (c) => {
    await c.typeAtEnd(SLIP);
    expect(await c.waitSlip('recieve'), 'no range on "recieve" in the prose, so the Field is not being checked');
    await c.sleep(1500);
    const inside = (await c.highlights()).filter((h) => h.inNotChecked);
    c.note({ inside });
    expect(!inside.length, `Slips in regions that are not checked: ${inside.map((h) => h.text).join(', ')}`);
    const ghostWord = await c.js('window.fixture.ghostWord ?? null');
    if (ghostWord) {
      pre(await c.js('fixture.notChecked().every((e) => e && e.isConnected)'), 'the ghost text is no longer on the page');
      const sent = c.ltRequests().filter((r) => r.text.includes(ghostWord));
      expect(!sent.length, `Smart Compose text went to LanguageTool: ${JSON.stringify(sent[0]?.text)}`);
    }
  }),
  row('never-flagged', 'Parity checklist', RICH, async (c) => {
    await c.typeAtEnd(SLIP);
    expect(await c.waitSlip('recieve'), 'no range on "recieve" in the prose, so the Field is not being checked');
    await c.sleep(1500);
    const all = (await c.highlights()).filter((h) => h.inHost);
    const flagged = all.filter((h) => h.inNeverFlag);
    expect(!flagged.length, `Slips on chips, emoji or inline code: ${flagged.map((h) => JSON.stringify(h.text)).join(', ')}`);
    const phrases = Object.keys(c.replies);
    const drifted = all.filter((h) => !h.inNotChecked && !phrases.includes(h.text));
    expect(!drifted.length, `ranges off their words: ${drifted.map((h) => JSON.stringify(h.text)).join(', ')}`);
    const word = WORD_AFTER_IMAGE_EMOJI[c.column.name];
    if (word) expect(all.some((h) => h.text === word), `no range exactly on "${word}" after the image emoji`);
  }),
  row('apply-undo', 'Parity checklist', ALL, async (c) => {
    await c.typeAtEnd(SLIP);
    expect(await c.waitSlip('recieve'), 'no range on "recieve"');
    await c.sleep(1600);
    const before = await c.js('__tr.text()');
    const outcome = await c.applyOnce();
    c.note({ outcome });
    expect(outcome.result === 'accepted', `Apply: ${outcome.result}`);
    await c.key({ key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, commands: ['undo'] }, 2);
    await c.sleep(500);
    const undone = await c.js('__tr.text()');
    expect(undone === before, 'one Ctrl+Z did not restore the whole text');
    expect(await c.waitSlip('recieve'), 'the Slip did not come back after Ctrl+Z');
  }),
  row('rerender-bold', 'Robustness', RICH, async (c) => {
    await c.typeAtEnd(SLIP);
    expect(await c.waitSlip('recieve'), 'no range on "recieve"');
    await c.js(`fixture.bold('recieve')`);
    await c.sleep(300);
    pre(await c.js(`__tr.isBold('recieve')`), 'the fixture did not bold "recieve"');
    expect(await c.until(() => c.typedSlip('recieve'), 3000), 'no live range on the typed "recieve" after bolding it');
  }),
  row('rerender-remote', 'Robustness', RICH, async (c) => {
    await c.typeAtEnd(SLIP);
    expect(await c.waitSlip('recieve'), 'no range on "recieve"');
    await c.js(`fixture.remoteEdit('A collaborator added this line above.')`);
    pre((await c.js('__tr.text()')).startsWith('A collaborator added this line above.'), 'the remote edit did not land');
    expect(await c.until(() => c.typedSlip('recieve'), 3000), 'no live range on the typed "recieve" after the remote edit');
  }),
  row('replaced-root', 'Robustness', RICH, async (c) => {
    await c.typeAtEnd(SLIP);
    expect(await c.waitSlip('recieve'), 'no range on "recieve" in the first root');
    await c.js('void fixture.replaceRoot()');
    await c.sleep(800);
    const stale = (await c.highlights()).filter((h) => !h.connected);
    expect(!stale.length, `${stale.length} ranges still point into the removed root`);
    await c.typeAtEnd(' The new root will recieve it.');
    expect(await c.waitSlip('recieve'), 'the new root did not become a Field with its own Slips');
  }),
  row('highlights-cleared', 'Robustness', ALL, async (c) => {
    await c.typeAtEnd(SLIP);
    const slip = await c.waitSlip('recieve');
    expect(slip, 'no range on "recieve"');
    await c.js('CSS.highlights.clear()');
    pre((await c.js('CSS.highlights.size')) === 0, 'the page could not clear CSS.highlights');
    await c.hover(slip.rect);
    let back = await c.waitSlip('recieve', 1500);
    c.note({ backOnHover: Boolean(back) });
    if (!back) {
      await c.typeAtEnd(' ');
      back = await c.waitSlip('recieve', 2000);
      c.note({ backOnRender: Boolean(back) });
    }
    expect(back, 'the underlines did not come back on hover or on the next render');
  }),
  row('decoys', 'Robustness', RICH, async (c) => {
    const decoys = await c.js(`fixture.decoys().map((d) => {
      d.element.addEventListener('focus', () => { d.element.dataset.verifyFocused = 'true'; });
      return { name: d.name, poke: d.poke };
    })`);
    for (const [i, decoy] of decoys.entries()) {
      if (decoy.poke === 'click') {
        const at = await c.js(`(() => { const r = fixture.decoys()[${i}].element.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
        await c.click(at.x, at.y);
        await c.type(' a dekoy question');
      } else if (decoy.poke === 'paste') {
        await c.focusEnd();
        await c.key({ key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, commands: ['paste'] }, 2);
        await c.sleep(300);
      }
      if (decoy.poke !== 'none') pre(await c.js(`fixture.decoys()[${i}].element.dataset.verifyFocused === 'true'`), `poking "${decoy.name}" did not focus it`);
    }
    await c.typeAtEnd(SLIP);
    expect(await c.waitSlip('recieve'), 'the focused editing host did not become a Field');
    await c.sleep(1500);
    const inDecoy = (await c.highlights()).filter((h) => h.inDecoy);
    expect(!inDecoy.length, `decoys got Slips: ${inDecoy.map((h) => h.text).join(', ')}`);
    const { visibleBox } = await c.js('__tr.hostBadge()');
    const strays = (await c.js('__tr.badges()')).filter((b) => !visibleBox || b.rect.x < visibleBox.left || b.rect.x > visibleBox.right || b.rect.y < visibleBox.top || b.rect.y > visibleBox.bottom);
    expect(!strays.length, `${strays.length} badges outside the editing host, so a decoy became a Field`);
    const sent = c.ltRequests().filter((r) => r.text.includes('dekoy'));
    expect(!sent.length, `decoy text went to LanguageTool: ${JSON.stringify(sent[0]?.text)}`);
  }),
  row('native-squiggle', 'Coexistence', ALL, async (c) => {
    await c.js('__tr.host().spellcheck = true');
    await c.typeAtEnd(SLIP);
    await c.focusEnd();
    const word = await c.js(`__tr.wordRect('recieve')`);
    pre(word, '"recieve" is not on the page');
    const native = (await c.until(async () => c.nativeSquigglePixels(word), 2000)) ?? 0;
    c.note({ nativeSquigglePixels: native });
    pre(native > 0, 'no native spellcheck squiggle under "recieve"');
    expect(await c.waitSlip('recieve'), 'no range on "recieve"');
    for (const dy of [2, 5]) {
      await c.mouseAway();
      const card = await c.hover({ x: word.x, y: word.bottom + dy });
      expect(card?.kind === 'Spelling', `no Hover card with the pointer ${dy} px below "recieve"`);
    }
  }),
  row('ime', 'Change detection', ALL, async (c) => {
    await c.typeAtEnd(' ');
    await c.ltQuiet();
    const composeAt = Date.now();
    await c.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
    await c.sleep(2000);
    const during = c.ltRequests(composeAt).filter((r) => r.text.includes('nihao'));
    const flagged = (await c.highlights()).filter((h) => h.inHost && h.text?.includes('nihao'));
    c.note({ during: during.length, flagged: flagged.length });
    expect(!during.length, 'the composing text went to LanguageTool before it was committed');
    expect(!flagged.length, 'the composing text got a Slip');
    const commitAt = Date.now();
    await c.send('Input.insertText', { text: 'nihao' });
    pre(await c.until(async () => (await c.js('__tr.text()')).includes('nihao'), 2000), 'the committed text is not in the editor');
    const checked = await c.until(async () => c.ltRequests(commitAt).some((r) => r.text.includes('nihao')), 8000);
    expect(checked, 'the committed text was not checked');
  }),
  row('long-content', 'Change detection', ['Gmail', 'ProseMirror'], async (c) => c.longContent(), { variant: 'long' }),
  row('apply-timing', 'Apply timing', RICH, async (c) => {
    const trials = { 1: [], 4: [] };
    for (const rate of [1, 4]) {
      for (let i = 0; i < 20; i++) {
        await c.load();
        await c.send('Emulation.setCPUThrottlingRate', { rate });
        let outcome;
        try {
          await c.typeAtEnd(SLIP);
          outcome = (await c.waitSlip('recieve')) ? await c.applyOnce() : { result: 'no underline' };
        } finally {
          await c.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        }
        trials[rate].push(outcome.result);
        await c.mouseAway();
        if (rate === 1 && i === 0 && !['accepted', 'unchanged', 'changedWrongly'].includes(outcome.result)) break;
      }
      if (trials[1].length < 20) break;
    }
    const count = (rate, result) => trials[rate].filter((r) => r === result).length;
    const summary = Object.fromEntries([1, 4].map((rate) => [`${rate}x`, Object.fromEntries([...new Set(trials[rate])].map((r) => [r, count(rate, r)]))]));
    c.note({ trials: summary });
    expect(trials[1].length === 20, `trial 1 at 1x: ${trials[1][0]}`);
    expect(!count(1, 'changedWrongly') && !count(4, 'changedWrongly'), 'a trial changed the text wrongly');
    expect(count(1, 'accepted') >= 19, `${count(1, 'accepted')}/20 accepted at 1x`);
    expect(count(4, 'accepted') >= 17, `${count(4, 'accepted')}/20 accepted at 4x`);
  }),
  row('apply-wrong', 'Apply timing', RICH, async (c) => {
    await c.typeAtEnd(SLIP);
    expect(await c.waitSlip('recieve'), 'no range on "recieve"');
    await c.sleep(1600);
    await c.js(`window.addEventListener('beforeinput', (event) => {
      if (event.isTrusted) return;
      setTimeout(() => {
        const { anchorNode, anchorOffset } = getSelection();
        if (anchorNode?.nodeType === Node.TEXT_NODE) anchorNode.insertData(anchorOffset, 'ZZ');
      }, 60);
    }, { capture: true }); true`);
    const outcome = await c.applyOnce();
    const note = (await c.card())?.note ?? null;
    c.note({ outcome, note });
    expect(note === 'Apply went wrong here. Press Ctrl+Z to undo it.', `the card did not say Apply went wrong: ${JSON.stringify(note)}`);
  }),
  row('badge-clipped', 'Placement', ALL, async (c) => {
    await c.typeAtEnd(SLIP);
    await c.waitSlip('recieve');
    if (c.column.textarea) {
      await c.js('window.scrollTo(0, __tr.host().getBoundingClientRect().top + scrollY - 40)');
      pre(await c.js('__tr.host().getBoundingClientRect().bottom > innerHeight'), 'the textarea is not cut by the viewport');
    } else {
      await c.js('fixture.scroller().scrollTop = 0');
      pre(await c.js('__tr.host().getBoundingClientRect().bottom > fixture.scroller().getBoundingClientRect().bottom'), 'the host is not cut by its scroller');
    }
    await c.sleep(500);
    const { visibleBox, badge } = await c.js('__tr.hostBadge()');
    c.note({ visibleBox, badge, all: await c.js('__tr.badges()') });
    expect(badge, 'no badge inside the Field\'s visible box');
  }, { field: 2 }),
  row('card-unrelated-scroll', 'Placement', ALL, async (c) => {
    await c.typeAtEnd(SLIP);
    const slip = await c.waitSlip('recieve');
    expect(slip, 'no range on "recieve"');
    expect(await c.hover(slip.rect), 'no Hover card opened');
    const other = c.column.textarea ? `document.querySelector('#other-scroller')` : 'fixture.otherScroller()';
    await c.js(`${other}.scrollTop += 200`);
    pre((await c.js(`${other}.scrollTop`)) > 0, 'the unrelated container did not scroll');
    await c.sleep(600);
    expect(await c.card(), 'the card closed when an unrelated container scrolled');
  }),
  row('card-own-scroll', 'Placement', ALL, async (c) => {
    if (c.column.textarea) await c.typeAtEnd('Line one.\nLine two.\nLine three.\nLine four.\nLine five.\nLine six.');
    await c.typeAtEnd(SLIP);
    const slip = await c.waitSlip('recieve');
    expect(slip, 'no range on "recieve"');
    const card = await c.hover(slip.rect);
    expect(card, 'no Hover card opened');
    const scroller = c.column.textarea ? '__tr.host()' : 'fixture.scroller()';
    const top0 = await c.js(`${scroller}.scrollTop`);
    const step = top0 >= 6 ? -6 : 6;
    await c.js(`${scroller}.scrollTop += ${step}`);
    pre((await c.js(`${scroller}.scrollTop`)) === top0 + step, 'the Field\'s container did not scroll by 6 px');
    await c.sleep(400);
    const moved = await c.card();
    c.note({ before: card.rect, after: moved?.rect });
    expect(moved, 'the card closed on a 6 px scroll of its Field\'s container');
    expect(Math.abs(card.rect.top - moved.rect.top - step) <= 2, `the card moved ${Math.round(moved.rect.top - card.rect.top)} px, not ${-step}`);
    await c.js(`${scroller}.scrollTop = ${step < 0 ? 0 : `${scroller}.scrollHeight`}`);
    pre(!(await c.js(`(() => { const w = __tr.wordRect('recieve'); const v = __tr.visibleBox(__tr.host()); return v && w.top < v.bottom && w.bottom > v.top; })()`)), 'the word is still in the visible box');
    await c.sleep(600);
    expect(!(await c.card()), 'the card stayed open after its Slip left the visible box');
  }, { field: 1 }),
  row('badge-resize', 'Placement', ALL, async (c) => {
    await c.typeAtEnd(SLIP);
    await c.waitSlip('recieve');
    const before = await c.js('__tr.hostBadge()');
    expect(before.badge, 'no badge before the resize');
    await c.js(c.column.textarea ? `__tr.host().style.width = '60%'` : `fixture.scroller().style.width = '60%'`);
    await c.sleep(600);
    const after = await c.js('__tr.hostBadge()');
    c.note({ before, after });
    pre(after.visibleBox && before.visibleBox.right - after.visibleBox.right > 50, 'the host did not shrink');
    expect(after.badge && Math.abs(after.badge.rect.right - after.visibleBox.right) <= 30, 'the badge did not follow the host\'s new right edge');
  }),
  row('modal-dialog', 'Placement', ['TipTap'], async (c) => {
    pre(await c.js(`Boolean(__tr.host().closest('dialog:modal'))`), 'the editor is not in an open modal dialog');
    await c.typeAtEnd(SLIP);
    const slip = await c.waitSlip('recieve');
    expect(slip, 'no range on "recieve"');
    expect(await c.hover(slip.rect), 'no Hover card opened');
    expect(await c.clickCard('Ignore here'), 'the card has no "Ignore here" button');
    expect(await c.waitGone('recieve'), 'a real click on Ignore here did nothing inside the modal dialog');
  }, { variant: 'modal' }),
  row('sticky-footer', 'Placement', ['Textarea'], async (c) => {
    await c.typeAtEnd(SLIP);
    await c.waitSlip('recieve');
    await c.js('window.scrollTo(0, __tr.host().getBoundingClientRect().top + scrollY - 40)');
    await c.sleep(500);
    const footer = await c.js(`(() => { const r = document.querySelector('.sticky-footer').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`);
    const { visibleBox, badge } = await c.js('__tr.hostBadge()');
    c.note({ footer, visibleBox, badge, all: await c.js('__tr.badges()') });
    pre(visibleBox && footer.top < visibleBox.bottom && footer.right >= visibleBox.right - 20, 'the sticky footer does not cover the textarea\'s bottom-right corner');
    const all = await c.js('__tr.badges()');
    const under = all.find((b) => b.rect.bottom > footer.top && b.rect.top < footer.bottom && b.rect.right > footer.left && b.rect.left < footer.right);
    expect(badge, 'no badge inside the textarea\'s visible box');
    expect(!under, 'the badge is under the sticky footer');
  }, { field: 2 }),
  row('badge-fade', 'Placement', ALL, async (c) => {
    await c.typeAtEnd(SLIP);
    await c.waitSlip('recieve');
    await c.sleep(2000);
    const idle = (await c.js('__tr.hostBadge()')).badge;
    expect(idle, 'no badge');
    await c.type('x');
    let faded = 1;
    await c.until(async () => {
      faded = Math.min(faded, (await c.js('__tr.hostBadge()')).badge?.opacity ?? 1);
      return faded <= 0.3;
    }, 1200);
    await c.sleep(2000);
    const back = (await c.js('__tr.hostBadge()')).badge?.opacity ?? 0;
    c.note({ idle: idle.opacity, faded, back });
    expect(faded <= 0.3, `the badge stayed at opacity ${faded} while typing`);
    expect(back >= idle.opacity - 0.05, `the badge is at opacity ${back} after 1.5 s idle, not back to ${idle.opacity}`);
  }),
];

function row(name, group, columns, run, options = {}) {
  return { name, group, columns, run, variant: options.variant ?? 'default', field: options.field ?? 0 };
}

export async function richEditors(h, { columns: columnFilter, rows: rowFilter }) {
  const unknownColumns = (columnFilter ?? []).filter((f) => !ALL.some((name) => name.toLowerCase() === f.toLowerCase()));
  const unknownRows = (rowFilter ?? []).filter((f) => !ROWS.some((r) => r.name === f));
  if (unknownColumns.length) h.die(`Unknown column ${unknownColumns.join(', ')}. Columns: ${ALL.join(', ')}`);
  if (unknownRows.length) h.die(`Unknown row ${unknownRows.join(', ')}. Rows: ${ROWS.map((r) => r.name).join(', ')}`);
  const columns = COLUMNS.filter((c) => !columnFilter || columnFilter.some((f) => f.toLowerCase() === c.name.toLowerCase()));
  const rows = ROWS.filter((r) => !rowFilter || rowFilter.includes(r.name));
  const state = h.readState();
  const replies = JSON.parse(fs.readFileSync(path.join(h.ROOT, LT_REPLIES), 'utf8'));
  const shotDir = path.join(state.evidenceDir, 'rich-editors');
  fs.mkdirSync(shotDir, { recursive: true });
  const cdp = await h.browser(state);
  const page = await h.tab(cdp, state, state.testPage);
  await page.send('Page.enable');
  const results = [];
  try {
    for (const r of rows) {
      for (const column of COLUMNS.filter((c) => columns.includes(c))) {
        if (!r.columns.includes(column.name)) {
          results.push({ row: r.name, column: column.name, result: 'n/a' });
          continue;
        }
        const started = Date.now();
        const c = cellContext(h, { cdp, page, state, column, row: r, replies, shotDir });
        let result = 'pass';
        let reason;
        try {
          await c.load();
          await r.run(c);
        } catch (error) {
          result = error instanceof CellFail ? 'fail' : 'error';
          reason = error instanceof CellFail || error instanceof CellPrecondition ? error.message : String(error.stack ?? error);
          if (error instanceof CellPrecondition) reason = `precondition: ${reason}`;
        }
        const shot = await c.screenshot().catch(() => undefined);
        await page.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
        const cell = { row: r.name, column: column.name, result, reason, ms: Date.now() - started, notes: c.notes, screenshot: shot };
        h.record(state, { command: `rich-editors ${r.name} ${column.name}`, result: cell });
        results.push(cell);
        console.error(`${result.padEnd(5)} ${r.name} / ${column.name}${reason ? `: ${reason.split('\n')[0]}` : ''}`);
      }
    }
  } finally {
    await page.send('Page.navigate', { url: state.testPage }).catch(() => {});
    cdp.close();
  }
  const table = matrix(rows, columns, results);
  const failures = results.filter((x) => x.result === 'fail' || x.result === 'error').map((x) => `${x.row} / ${x.column}: ${x.result}: ${x.reason.split('\n')[0]}`);
  const report = `${table}\n\n${failures.join('\n')}\n`;
  fs.writeFileSync(path.join(state.evidenceDir, 'rich-editors.txt'), report);
  console.log(report);
  console.log(`Evidence: ${path.relative(h.ROOT, state.evidenceDir)} (log.jsonl, rich-editors.txt, rich-editors/*.png)`);
  return failures.length === 0;
}

function matrix(rows, columns, results) {
  const names = columns.map((c) => c.name);
  const width = Math.max(...rows.map((r) => r.name.length), 'row'.length);
  const colWidth = Math.max(...names.map((n) => n.length), 5);
  const line = (cells) => cells.map((cell, i) => (i === 0 ? cell.padEnd(width) : cell.padEnd(colWidth))).join(' | ').trimEnd();
  const out = [line(['row', ...names]), line(['-'.repeat(width), ...names.map(() => '-'.repeat(colWidth))])];
  for (const r of rows) out.push(line([r.name, ...names.map((n) => results.find((x) => x.row === r.name && x.column === n)?.result ?? '')]));
  const count = (result) => results.filter((x) => x.result === result).length;
  out.push('', `pass ${count('pass')}, fail ${count('fail')}, error ${count('error')}, n/a ${count('n/a')}`);
  return out.join('\n');
}

function cellContext(h, { cdp, page, state, column, row, replies, shotDir }) {
  const notes = {};
  const target = column.textarea ? { textarea: true, field: row.field } : { textarea: false };
  let navigatedAt = 0;
  const c = {
    column, row, replies, notes,
    sleep: h.sleep,
    send: (method, params) => page.send(method, params),
    note: (data) => Object.assign(notes, data),
    js: (expression) => page.eval(expression),
    async until(fn, timeoutMs) {
      return h.until('', fn, timeoutMs, 150).catch(() => null);
    },
    async load() {
      const variant = row.variant === 'default' ? '' : `?variant=${row.variant}`;
      const url = `${state.testPage}${column.page}${variant}`;
      navigatedAt = Date.now();
      await page.send('Page.navigate', { url });
      await h.until(`${url} to load`, () => page.eval(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && ${column.textarea ? 'true' : `document.documentElement.dataset.fixtureReady === 'true'`}`), 15000);
      await h.sleep(600);
      await page.eval(PAGE_LIB);
      await page.eval(`window.__tr.target = ${JSON.stringify(target)}`);
      const seeds = column.textarea ? await textareaSeeds(page) : await page.eval('fixture.seeds()');
      const missing = seeds.filter((s) => !s.ok);
      if (missing.length) throw new CellPrecondition(`seeds missing: ${missing.map((s) => `${s.name} (${s.detail ?? ''})`).join('; ')}`);
      if (!column.textarea) notes.library = await page.eval('fixture.library');
    },
    async highlights() {
      return page.eval('__tr.highlights()');
    },
    async typedSlip(word) {
      return page.eval(`__tr.typedSlip(${JSON.stringify(word)})`);
    },
    async waitSlip(word, timeoutMs = TIMEOUT_MS) {
      const hit = await c.until(() => c.typedSlip(word), timeoutMs);
      if (!hit) notes[`ranges when "${word}" was missing`] = (await c.highlights()).map((x) => x.text);
      return hit;
    },
    async waitGone(word) {
      return c.until(async () => !(await c.highlights()).some((x) => x.inHost && x.text === word), 3000);
    },
    async click(x, y) {
      await h.mouseClick(page, x, y);
      await h.sleep(150);
    },
    async focusEnd() {
      const at = await page.eval('__tr.clickPoint()');
      await c.click(at.x, at.y);
      if (column.textarea) await h.key(page, { key: 'End', code: 'End', windowsVirtualKeyCode: 35, commands: ['moveToEndOfDocument'] }, 2);
      else await h.key(page, { key: 'End', code: 'End', windowsVirtualKeyCode: 35, commands: ['moveToEndOfLine'] });
      await h.sleep(50);
    },
    async type(text) {
      await h.typeText(page, text);
    },
    async typeAtEnd(text) {
      await c.focusEnd();
      await h.typeText(page, text);
      const landed = (await page.eval('__tr.text()')).includes(text.trim().split('\n').at(-1));
      pre(landed, `typed text did not land in the editor: ${JSON.stringify(text)}`);
    },
    key: (def, modifiers) => h.key(page, def, modifiers),
    async wheel(x, y, deltaY) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
      await h.sleep(300);
    },
    async mouseAway() {
      await h.mouseMove(page, 2, 2);
      await h.sleep(400);
    },
    async card() {
      const card = await h.readCard(page);
      if (!card) return null;
      const rect = await page.send('DOM.getBoxModel', { nodeId: card.nodeId }).then(({ model }) => {
        const [x1, y1, , , x3, y3] = model.border;
        return { left: x1, top: y1, right: x3, bottom: y3 };
      }).catch(() => null);
      return rect && { ...card, rect };
    },
    async hover({ x, y }) {
      await h.mouseMove(page, x - 1, y);
      await h.mouseMove(page, x, y);
      return c.until(() => c.card(), 2500);
    },
    async clickCard(label) {
      const card = await c.card();
      const button = card?.buttons.find((b) => b.label === label);
      if (!button) return false;
      const at = await h.centerOf(page, button.nodeId);
      await h.mouseClick(page, at.x, at.y);
      await h.sleep(300);
      return true;
    },
    async applyOnce() {
      const slip = await c.typedSlip('recieve');
      if (!slip) return { result: 'no underline' };
      const before = await page.eval('__tr.text()');
      if (!(await c.hover(slip.rect))) return { result: 'no card' };
      await c.clickCard('Show answer');
      if (!(await c.clickCard('Apply receive'))) return { result: 'no Apply' };
      await h.sleep(600);
      const after = await page.eval('__tr.text()');
      const expected = before.split('I will recieve it.').length === 2 ? before.replace('I will recieve it.', 'I will receive it.') : null;
      const result = after === expected ? 'accepted' : after === before ? 'unchanged' : 'changedWrongly';
      return { result };
    },
    ltRequests(since = navigatedAt) {
      const log = path.join(state.evidenceDir, 'log.jsonl');
      return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
        .filter((e) => e.command === 'stub-lt answered' && Date.parse(e.at) >= since)
        .map((e) => ({ ...e.result, at: e.at }));
    },
    async ltQuiet() {
      await c.until(async () => {
        const last = c.ltRequests().at(-1);
        return !last || Date.now() - Date.parse(last.at) > 1500;
      }, 10000);
    },
    async tally() {
      const popupUrl = `chrome-extension://${state.extId}/popup.html`;
      const { targetId } = await cdp.send('Target.createTarget', { url: popupUrl, background: true });
      try {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        const read = `[...document.querySelectorAll('#counts h2')].map((h) => [h.firstChild.textContent, Number(h.querySelector('.count').textContent)])`;
        await h.sleep(500);
        const r = await cdp.send('Runtime.evaluate', { expression: read, returnByValue: true }, sessionId);
        return Object.fromEntries(r.result.value ?? []);
      } finally {
        await cdp.send('Target.closeTarget', { targetId });
      }
    },
    async dictionaryHas(word, { remove }) {
      const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${state.extId}/options.html`, background: true });
      try {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        const run = async (expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
        await h.sleep(500);
        const listed = await run(`[...document.querySelectorAll('#dictionary li')].some((li) => li.textContent.includes(${JSON.stringify(word)}))`);
        if (listed && remove) {
          const at = await run(`(() => { const b = document.querySelector('#dictionary button[aria-label=' + ${JSON.stringify(JSON.stringify(`Remove "${word}"`))} + ']'); b.scrollIntoView(); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
          const send = (method, params) => cdp.send(method, params, sessionId);
          await h.mouseClick({ send }, at.x, at.y);
          await h.sleep(300);
        }
        return listed;
      } finally {
        await cdp.send('Target.closeTarget', { targetId });
      }
    },
    async nativeSquigglePixels(word) {
      const clip = { x: Math.max(0, word.left - 2), y: Math.max(0, word.bottom - 6), width: word.width + 4, height: 14, scale: 1 };
      const { data } = await withTypeRightMarksHidden(page, () => page.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false }));
      const file = path.join(shotDir, `${column.name}-${row.name}-crop.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      const png = decodePng(Buffer.from(data, 'base64'));
      let count = 0;
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const [r, g, b] = png.pixel(x, y);
          if (r >= 225 && g <= 90 && b <= 90 && Math.hypot(r - 255, g - 37, b - 37) < Math.hypot(r - 225, g - 29, b - 72)) count++;
        }
      }
      return count;
    },
    async longContent() {
      return longContent(c, h, { cdp, state });
    },
    async screenshot() {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(shotDir, `${column.name}-${row.name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return path.relative(h.ROOT, file);
    },
  };
  return c;
}

async function withTypeRightMarksHidden(page, capture) {
  await page.eval(`window.__trHidden = [...CSS.highlights].filter(([name]) => name.startsWith('type-right-'));
    __trHidden.forEach(([name]) => CSS.highlights.delete(name))`);
  try {
    await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    return await capture();
  } finally {
    await page.eval(`__trHidden.forEach(([name, h]) => CSS.highlights.set(name, h))`);
  }
}

async function textareaSeeds(page) {
  return page.eval(`(() => {
    const t = document.querySelectorAll('textarea');
    const footer = document.querySelector('.sticky-footer');
    return [
      { name: 'three textareas', ok: t.length === 3, detail: String(t.length) },
      { name: 'field 1 scrolls', ok: t[1] && t[1].clientHeight < 80, detail: String(t[1]?.clientHeight) },
      { name: 'field 2 taller than the viewport', ok: t[2] && t[2].getBoundingClientRect().height > innerHeight, detail: String(t[2]?.getBoundingClientRect().height) },
      { name: 'sticky footer after field 2', ok: Boolean(footer) && getComputedStyle(footer).position === 'sticky' && t[2]?.nextElementSibling === footer },
      { name: 'unrelated scroller', ok: Boolean(document.querySelector('#other-scroller')) },
    ];
  })()`);
}

const BUDGET_P95_MS = 4;
const BUDGET_TASK_MS = 50;

async function longContent(c, h, { cdp, state }) {
  const script = `chrome-extension://${state.extId}/content-scripts/`;
  await c.js('__tr.clickPoint()');
  const firstCheck = contentScriptTasks(await traced(cdp, h, async () => {
    await c.focusEnd();
    await c.sleep(1000);
    await c.ltQuiet();
  }), script);
  const attach = firstCheck.find((t) => t.dispatched.includes('focusin'));
  const otherTasks = firstCheck.filter((t) => t !== attach).map((t) => t.ms);
  const flaggedAtStart = (await c.highlights()).filter((x) => x.inHost).length;
  const typing = {};
  const frames = {};
  for (const rate of [1, 4]) {
    await c.send('Emulation.setCPUThrottlingRate', { rate });
    try {
      const events = await traced(cdp, h, async () => {
        await c.focusEnd();
        await c.type(' We will recieve the rest of the files tomorrow.');
      });
      const tasks = contentScriptTasks(events, script);
      typing[rate] = tasks.filter((t) => t.dispatched.includes('keydown')).map((t) => t.ms);
      frames[rate] = tasks.filter((t) => t.animationFrame && !t.dispatched.includes('keydown')).map((t) => t.ms);
    } finally {
      await c.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
  }
  const quantile = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * q) - 1] : 0);
  const p95 = (xs) => quantile(xs, 0.95);
  const spread = (xs) => ({ tasks: xs.length, p50Ms: round(quantile(xs, 0.5)), p95Ms: round(p95(xs)), maxMs: round(Math.max(0, ...xs)) });
  c.note({
    firstCheck: { tasksWithTypeRightWork: firstCheck.length, attachReadMs: round(attach?.ms ?? 0), longestOtherTaskMs: round(Math.max(0, ...otherTasks)) },
    typing1x: { batches: typing[1].length, p95Ms: round(p95(typing[1])), animationFrames: spread(frames[1]) },
    typing4x: { batches: typing[4].length, p95Ms: round(p95(typing[4])), animationFrames: spread(frames[4]) },
    rangesOnHostAfterFirstCheck: flaggedAtStart,
  });
  const typed = await c.waitSlip('recieve');
  expect(typed && typing[1].length, 'Type Right is not working on the long Field (no work per keystroke, or no range on the typed Slip)');
  if (c.column.name === 'ProseMirror') expect(flaggedAtStart >= 720, `only ${flaggedAtStart} of the ~800 seeded Slips were underlined after the first check`);
  expect(p95(typing[1]) <= BUDGET_P95_MS, `p95 per mutation batch is ${round(p95(typing[1]))} ms at 1x (budget ${BUDGET_P95_MS} ms)`);
  expect(Math.max(0, ...otherTasks) <= BUDGET_TASK_MS, `a task spent ${round(Math.max(...otherTasks))} ms in Type Right during the first check (budget ${BUDGET_TASK_MS} ms)`);
}

const round = (ms) => Math.round(ms * 100) / 100;

async function traced(cdp, h, fn) {
  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  const done = new Promise((resolve) => cdp.on('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel'] } });
  try {
    await fn();
  } finally {
    await cdp.send('Tracing.end');
    await done;
  }
  return events;
}

function contentScriptTasks(events, scriptPrefix) {
  const calls = events.filter((e) => e.name === 'FunctionCall' && e.ph === 'X' && e.args?.data?.url?.startsWith(scriptPrefix));
  const dispatches = events.filter((e) => e.name === 'EventDispatch');
  const frames = events.filter((e) => e.name === 'FireAnimationFrame');
  const tasks = events.filter((e) => e.name === 'RunTask' && e.ph === 'X');
  const out = [];
  for (const task of tasks) {
    const inside = (e) => e.pid === task.pid && e.tid === task.tid && e.ts >= task.ts && e.ts + (e.dur ?? 0) <= task.ts + task.dur;
    const own = calls.filter(inside);
    if (!own.length) continue;
    let total = 0;
    let end = -1;
    for (const call of own.sort((a, b) => a.ts - b.ts)) {
      if (call.ts >= end) total += call.dur;
      else if (call.ts + call.dur > end) total += call.ts + call.dur - end;
      end = Math.max(end, call.ts + call.dur);
    }
    out.push({ ts: task.ts, ms: total / 1000, dispatched: dispatches.filter(inside).map((e) => e.args?.data?.type), animationFrame: frames.some(inside) });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = { 2: 3, 6: 4 }[data[9]] ?? die(`unsupported PNG colour type ${data[9]}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const v = raw[y * (stride + 1) + 1 + x];
      px[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  return { width, height, pixel: (x, y) => [...px.subarray((y * width + x) * channels, (y * width + x) * channels + 3)] };
}

function die(message) {
  throw new Error(message);
}
