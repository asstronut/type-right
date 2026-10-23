import { expose } from './fixture.js';
import { CHECK_EMOJI } from './images.js';
import { buildPage, check, el, getVariant, tallerThanScroller, textboxAttributes } from './layout.js';
import { FILLER, countCycleWords, longParagraphs } from './prose.js';

const { column, library } = __FIXTURE__;
const variant = getVariant('long');
const { scroller, otherScroller, mount, slot } = buildPage(column);

const escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const defaultQuote = [
  'Hi, the invoice is attached. Please check the adress and confirm on this thread.',
  'If the total looks wrong, tell me before Friday.',
  FILLER,
  'Thanks, Budi',
];

const quoteParagraphs = variant === 'long' ? longParagraphs() : defaultQuote;

const ROOT_HTML = `<div id=":t4" class="Am aiL Al editable LW-avf tS-tW" hidefocus="true" aria-label="Message Body" writingsuggestions="false" g_editable="true" role="textbox" aria-multiline="true" contenteditable="true" tabindex="1" style="direction: ltr; min-height: 225px;" itacorner="6,7:1,1,0,0" spellcheck="false" aria-owns=":vk" aria-controls=":vk" aria-expanded="false"><div><div class="gmail_default" style="font-family: georgia, serif;">\u200b<span style="font-family: Arial, Helvetica, sans-serif; background-color: transparent;">@budi thanks for fixing the bug! I merged your change into \`main\`.</span></div>The build passed on the first try.<br><br>Budi's note was short: "it works on my machine." Let's hope it works everywhere <img data-emoji="✅" class="an1" alt="✅" aria-label="✅" draggable="false" src="${CHECK_EMOJI}" loading="lazy"> See https://example.com/pull/42 if you want to check the diffrence.<br clear="all"></div><div><br></div><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature"><div dir="ltr"><font face="georgia,serif">Sender Name<br></font></div></div><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Mon, Oct 19, 2026 at 9:00 AM Budi &lt;<a href="mailto:budi@example.com">budi@example.com</a>&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin: 0px 0px 0px 0.8ex; border-left: 1px solid rgb(204, 204, 204); padding-left: 1ex;"><div dir="ltr">${quoteParagraphs.map((paragraph) => `<div>${escapeHtml(paragraph)}</div>`).join('')}</div></blockquote></div></div>`;

mount.innerHTML = `<div class="aO7"><div class="Ar Au">${ROOT_HTML}</div></div>`;

const hiddenTextarea = el('textarea', {
  id: ':ta',
  class: 'Ak aiL',
  style: 'display: none;',
  'aria-label': 'Message Body',
  spellcheck: 'true',
  tabindex: '1',
  form: 'nosend',
});
hiddenTextarea.value = 'a dekoy body';
mount.append(hiddenTextarea);

const askGemini = el('div', {
  jsname: 'ZeIRi',
  enterkeyhint: 'send',
  spellcheck: 'true',
  autocomplete: 'chr-off',
  contenteditable: 'true',
  tabindex: '0',
  role: 'combobox',
  'aria-label': 'Ask Gemini',
  'aria-expanded': 'false',
  'aria-controls': 'ucc-2',
  'aria-autocomplete': 'list',
  style: 'margin-bottom: 8px; padding: 4px 8px; border: 1px solid #bbb; border-radius: 16px; white-space: nowrap; overflow: hidden; min-height: 24px;',
});
slot.prepend(askGemini);

let root = mount.querySelector('[g_editable]');

const host = () => root;
const typingBlock = () => [...root.children].find((block) => block.textContent.includes('check the diffrence.'));
const quote = () => root.querySelector('div.gmail_quote');
const signaturePrefix = () => root.querySelector('span.gmail_signature_prefix');
const signature = () => root.querySelector('div.gmail_signature');
const notChecked = () => [signaturePrefix(), signature(), quote()];

function seeds() {
  const quoted = quote();
  const checks = [
    textboxAttributes(root, 'false'),
    check('compose root has g_editable', root.getAttribute('g_editable') === 'true' && root.isContentEditable, '#:t4'),
    check('leading U+200B', typingBlock().textContent.startsWith('\u200b'), JSON.stringify(typingBlock().textContent.slice(0, 2))),
    check('image emoji', root.querySelector('img[data-emoji]')?.src.startsWith('data:'), 'img[data-emoji] with a data: URI'),
    check('signature', signaturePrefix()?.textContent === '-- ' && signature()?.textContent.includes('Sender Name'), 'span.gmail_signature_prefix + div.gmail_signature'),
    check(
      'quoted history',
      quoted?.querySelector(':scope > div.gmail_attr + blockquote.gmail_quote')?.textContent.includes(variant === 'long' ? 'recieve' : 'adress') && quoted.querySelector('div.gmail_attr')?.textContent.startsWith('On Mon, Oct 19, 2026'),
      'div.gmail_quote > div.gmail_attr + blockquote.gmail_quote',
    ),
    check(
      'typing block before the signature',
      Boolean(typingBlock()?.querySelector('.gmail_default')) && Boolean(typingBlock().compareDocumentPosition(signature()) & Node.DOCUMENT_POSITION_FOLLOWING),
      'div holding "check the diffrence."',
    ),
    check('decoy: hidden textarea#:ta', hiddenTextarea.isConnected && hiddenTextarea.offsetParent === null && hiddenTextarea.value === 'a dekoy body', 'textarea#:ta'),
    check('decoy: Ask Gemini combobox', askGemini.getAttribute('role') === 'combobox' && askGemini.offsetParent !== null && askGemini.isContentEditable, 'visible single-line combobox'),
    tallerThanScroller(root, scroller),
  ];
  if (variant === 'long') {
    const length = quoted.textContent.length;
    const words = countCycleWords(quoted.textContent);
    checks.push(check('50k quote', length >= 48000 && length <= 52000, `${length} chars`));
    checks.push(check('800 stub words in the quote', words >= 720 && words <= 880, `${words} stub words`));
  }
  return checks;
}

function lastTextMatch(word) {
  const skipped = notChecked();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let found = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (skipped.some((region) => region.contains(node))) continue;
    const index = node.data.lastIndexOf(word);
    if (index >= 0) found = { node, index };
  }
  if (!found) throw new Error(`"${word}" is not in the compose body outside its signature and quote`);
  return found;
}

function bold(word) {
  const { node, index } = lastTextMatch(word);
  const range = document.createRange();
  range.setStart(node, index);
  range.setEnd(node, index + word.length);
  range.surroundContents(document.createElement('b'));
}

function remoteEdit(text) {
  root.insertBefore(el('div', { text }), root.firstChild);
}

function replaceRoot() {
  const clone = root.cloneNode(true);
  root.replaceWith(clone);
  root = clone;
  return root;
}

expose({
  column,
  variant,
  library,
  host,
  text: () => root.innerText,
  seeds,
  typingBlock,
  notChecked,
  neverFlag: () => [...root.querySelectorAll('img[data-emoji]')],
  decoys: () => [
    { name: 'hidden textarea#:ta', element: hiddenTextarea, poke: 'none' },
    { name: 'visible single-line Ask Gemini combobox', element: askGemini, poke: 'click' },
  ],
  bold,
  remoteEdit,
  replaceRoot,
  scroller: () => scroller,
  otherScroller: () => otherScroller,
});
