// node drive.mjs <browserExe>: serves page.html, loads ./ext in headless Chromium, runs probe steps over CDP.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, '$1');
const exe = process.argv[2];
const tag = process.argv[3] ?? 'edge';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(fs.readFileSync(path.join(DIR, 'page.html')));
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/page.html`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hlprobe-'));
const ext = path.join(DIR, 'ext');
const browser = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--window-size=900,700', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let port;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(200);
  try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {}
}
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(DIR, `${tag}-${name}.png`), Buffer.from(r.result.data, 'base64')); };
const probe = (key) => evaluate(`document.documentElement.dataset.probe${key} ?? null`);
const step = async (name, key) => { await evaluate(`document.dispatchEvent(new CustomEvent('probe-step', { detail: '${name}' }))`); await sleep(400); return JSON.parse(await probe(key) ?? 'null'); };

await send('Page.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 50 && !(await probe('Ready')); i++) await sleep(200);
const results = { browser: (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser };
results.initial = JSON.parse(await probe('Initial'));
results.opaqueRange = await evaluate(`({ global: typeof OpaqueRange, textareaRangeMembers: Object.getOwnPropertyNames(HTMLTextAreaElement.prototype).concat(Object.getOwnPropertyNames(HTMLElement.prototype)).filter((n) => /range/i.test(n)) })`);
results.pageWorldSeesRegistry = await evaluate('JSON.stringify(window.pageSaw())');
results.pageWorldGetIsSameObject = await evaluate(`(() => { const h = CSS.highlights.get('tr-spelling'); return h ? { size: h.size, ctor: h.constructor.name } : null; })()`);
await sleep(300);
results.opaque = JSON.parse(await probe('Opaque') ?? 'null');
await shot('1-initial');
// Type at the start of the textarea and see whether the OpaqueRange follows.
await evaluate(`(() => { const ta = document.getElementById('ta'); ta.focus(); ta.setSelectionRange(0, 0); })()`);
await send('Input.insertText', { text: 'Hi. ' });
await sleep(300);
results.opaqueAfterTyping = JSON.parse(await probe('OpaqueAfterTyping') ?? 'null');
await shot('1b-textarea-typed');
await evaluate(`document.activeElement.blur()`);

// Real mouse move over "kucing" and just below it.
const k = results.initial.translation.rect;
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: k[0] + k[2] / 2, y: k[1] + k[3] / 2 });
await sleep(200);
results.mouseOnWord = JSON.parse(await probe('Mouse'));

results.mutate = await step('mutate', 'Mutate');
await shot('2-after-mutate');
results.rebuild = await step('rebuild', 'Rebuild');
await shot('3-after-rebuild');
results.shadowstyle = await step('shadowstyle', 'Shadowstyle');
await shot('4-shadow-styled');
await evaluate(`document.getElementById('scroller').scrollTop = 1000`);
await sleep(300);
results.scroll = await step('scroll', 'Scroll');
await shot('5-scrolled');
results.bench = await step('bench', 'Bench');
await sleep(800);
results.bench = JSON.parse(await probe('Bench'));
await evaluate('CSS.highlights.clear()');
results.afterPageClear = await step('afterpageclear', 'Afterpageclear');

console.log(JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(DIR, `${tag}-results.json`), JSON.stringify(results, null, 2));
browser.kill();
server.close();
process.exit(0);
