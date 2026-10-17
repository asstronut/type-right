#!/usr/bin/env node
// Drives the built Type Right extension in a throwaway headless Edge over CDP.
// Run from the repo root: node .claude/skills/verify/scripts/verify.mjs <command> [args]
// Commands are listed in usage() below and in ../SKILL.md.
import { spawn, execSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const VERIFY_DIR = path.join(ROOT, '.verify');
const RUN_DIR = path.join(VERIFY_DIR, 'run');
const STATE_FILE = path.join(RUN_DIR, 'state.json');
const EXT_DIR = path.join(ROOT, '.output', 'chrome-mv3');
const TEST_PAGE_DIR = path.join(ROOT, 'test-page');
const SCRIPT = path.resolve(process.argv[1]);

const KINDS = {
  '#e11d48': 'spelling', 'rgb(225, 29, 72)': 'spelling',
  '#2563eb': 'grammar', 'rgb(37, 99, 235)': 'grammar',
  '#7c3aed': 'wording', 'rgb(124, 58, 237)': 'wording',
  '#0f766e': 'translation', 'rgb(15, 118, 110)': 'translation',
};

/** The Providers' endpoints, which `stub-llm` answers in place of the real ones. */
const LLM_URL_PATTERNS = ['https://api.z.ai/*', 'https://generativelanguage.googleapis.com/*'];

function usage() {
  console.log(`usage: node .claude/skills/verify/scripts/verify.mjs <command>

  launch [--dark]                build, start test page + headless Edge with the extension (--dark: prefers-color-scheme dark)
  doctor                         read-only health check of the running instance
  tabs                           list open tabs
  open <options|popup|consent|url>  open a new tab
  type <text> [--field N | --selector <css>] [--clear]
                                 click textarea N (0-based), or the element matching <css>,
                                 and type real keystrokes (\\n = Enter)
  press <key>                    press ArrowDown, ArrowUp, Enter, Escape or Tab in the tab
  value [--field N]              print the textarea's value
  slips [--field N] [--wait <text>] [--timeout ms]  print underlined Slips (waits for <text> if given)
  badge [--field N]              print the field's LLM badge (label, title, color)
  hover <text> [--field N]       move the mouse onto the underlined <text>, print the Hover card
  card                           print the Hover card that is open now
  click-card <button text>       click a Hover card button (Show answer, Apply, Ignore here, Add to dictionary)
  click <css selector>           real mouse click on an element in the tab (extension pages)
  screenshot <name>              save <name>.png into the evidence dir
  eval <js>                      evaluate in the tab's page (inspection only)
  sw-eval <js>                   evaluate in the extension's service worker (inspection only)
  stub-llm <replies.json>        answer LLM requests from a file instead of the Provider, until cleanup
  cleanup                        close Edge and the test page server; evidence is kept

Tab-scoped commands take --tab <url substring>; the default is the test page.`);
}

// ---------- args, state, evidence ----------

const argv = process.argv.slice(2);
const cmd = argv.shift();
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
}
function bool(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) die('No instance: run `launch` first.');
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function die(message) {
  console.error(message);
  process.exit(1);
}

function record(state, entry) {
  fs.appendFileSync(path.join(state.evidenceDir, 'log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

function out(state, command, result) {
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  if (state) record(state, { command, result });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs = 20000, everyMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(everyMs);
  }
}

// ---------- CDP ----------

class Cdp {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`CDP connect failed: ${url}`));
    });
    return new Cdp(ws);
  }
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method) this.listeners.get(msg.method)?.(msg.params, msg.sessionId);
      const waiter = msg.id && this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${waiter.method}: ${msg.error.message}`));
      else waiter.resolve(msg.result);
    };
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  on(method, listener) {
    this.listeners.set(method, listener);
  }
  close() {
    this.ws.close();
  }
}

async function browser(state) {
  return Cdp.connect(`ws://127.0.0.1:${state.cdpPort}${state.cdpPath}`);
}

async function targets(cdp) {
  return (await cdp.send('Target.getTargets')).targetInfos;
}

/** Attaches to the tab whose URL contains `match` (default: the test page). */
async function tab(cdp, state, match = flag('tab', state.testPage)) {
  const resolved = EXT_PAGES.includes(match) ? `chrome-extension://${state.extId}/${match}.html` : match;
  const info = (await targets(cdp)).find((t) => t.type === 'page' && t.url.includes(resolved));
  if (!info) throw new Error(`No tab matching "${resolved}". Open tabs:\n${(await targets(cdp)).filter((t) => t.type === 'page').map((t) => `  ${t.url}`).join('\n')}`);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
  await cdp.send('Target.activateTarget', { targetId: info.targetId });
  const page = {
    sessionId,
    url: info.url,
    send: (method, params) => cdp.send(method, params, sessionId),
    async eval(expression) {
      const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
  };
  return page;
}

const EXT_PAGES = ['options', 'popup', 'consent'];

async function serviceWorker(cdp, state) {
  const info = (await targets(cdp)).find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${state.extId}/`));
  if (!info) return undefined;
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
  return {
    async eval(expression) {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
  };
}

// ---------- input ----------

async function mouseMove(page, x, y) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
}

async function mouseClick(page, x, y) {
  await mouseMove(page, x, y);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function key(page, def, modifiers = 0) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, ...def });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key: def.key, code: def.code, windowsVirtualKeyCode: def.windowsVirtualKeyCode });
}

const NAMED_KEYS = {
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
};

async function typeText(page, text) {
  for (const ch of text) {
    if (ch === '\n') await key(page, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    else await key(page, { key: ch, text: ch, unmodifiedText: ch });
    await sleep(15);
  }
}

// ---------- page probes (main world; the overlay and badge live in the light DOM) ----------

const FIELD_JS = (n) => `document.querySelectorAll('textarea')[${n}]`;

/** The overlay drawn over field N: the one whose box matches the field's padding box. */
const PROBE_JS = (n) => `(() => {
  const field = ${FIELD_JS(n)};
  if (!field) return { error: 'no textarea #${n}' };
  const f = field.getBoundingClientRect();
  const near = (a, b) => Math.abs(a - b) < 4;
  const overlay = [...document.querySelectorAll('[data-type-right-overlay]')]
    .find((o) => { const r = o.getBoundingClientRect(); return near(r.left, f.left + field.clientLeft) && near(r.top, f.top + field.clientTop); });
  const badges = [...document.querySelectorAll('[data-type-right-badge]')];
  const badge = badges.map((b) => [b, b.getBoundingClientRect()])
    .filter(([b]) => b.style.display !== 'none')
    .sort(([, a], [, b]) => Math.hypot(a.right - f.right, a.bottom - f.bottom) - Math.hypot(b.right - f.right, b.bottom - f.bottom))[0]?.[0];
  return {
    attached: Boolean(overlay),
    value: field.value,
    slips: overlay ? [...overlay.querySelectorAll('span')].map((s) => {
      const r = s.getBoundingClientRect();
      return { text: s.textContent, color: s.style.textDecorationColor, x: r.left + r.width / 2, y: r.bottom - 2 };
    }) : [],
    badge: badge ? { label: badge.textContent, title: badge.title, color: badge.style.background || badge.style.backgroundColor } : null,
    field: { x: f.left + f.width / 2, y: f.top + f.height / 2 },
  };
})()`;

async function probe(page, n) {
  const p = await page.eval(PROBE_JS(n));
  if (p.error) die(p.error);
  p.slips = p.slips.map((s) => ({ ...s, kind: KINDS[s.color] ?? s.color }));
  return p;
}

/** The Hover card lives in a closed shadow root; CDP's pierced DOM still reaches it. */
async function readCard(page) {
  const { root } = await page.send('DOM.getDocument', { depth: -1, pierce: true });
  const host = findNode(root, (n) => n.localName === 'type-right-card');
  const shadow = host?.shadowRoots?.[0];
  const card = shadow && findNode(shadow, (n) => n.localName === 'div' && attr(n, 'class') === 'card');
  if (!card) return null;
  const style = await page.send('DOM.getAttributes', { nodeId: host.nodeId });
  const hostStyle = attrList(style.attributes, 'style') ?? '';
  if (/display:\s*none/.test(hostStyle)) return null;
  const text = (cls) => textOf(findNode(card, (n) => (attr(n, 'class') ?? '').split(' ').includes(cls)));
  const buttons = [];
  // Each suggestion has its own Apply button; its title names the suggestion, so label it "Apply <suggestion>".
  walk(card, (n) => {
    if (n.localName !== 'button') return;
    const replace = /^Replace with "(.*)"$/.exec(attr(n, 'title') ?? '');
    buttons.push({ label: replace ? `Apply ${replace[1]}` : textOf(n), nodeId: n.nodeId });
  });
  const suggestions = [];
  walk(card, (n) => { if (attr(n, 'class') === 'suggestion') suggestions.push(textOf(n)); });
  return { kind: text('kind'), type: text('type'), explanation: text('explanation'), suggestions, buttons };
}

function walk(node, fn) {
  fn(node);
  for (const child of node.children ?? []) walk(child, fn);
  for (const s of node.shadowRoots ?? []) walk(s, fn);
}
function findNode(node, pred) {
  let found;
  walk(node, (n) => { if (!found && pred(n)) found = n; });
  return found;
}
function attr(node, name) {
  return attrList(node.attributes, name);
}
function attrList(list, name) {
  if (!list) return undefined;
  const i = list.indexOf(name);
  return i !== -1 && i % 2 === 0 ? list[i + 1] : undefined;
}
function textOf(node) {
  if (!node) return '';
  let s = '';
  walk(node, (n) => { if (n.nodeType === 3) s += n.nodeValue; });
  return s.trim();
}

function cardView(card) {
  return card && { ...card, buttons: card.buttons.map((b) => b.label) };
}

async function centerOf(page, nodeId) {
  const { model } = await page.send('DOM.getBoxModel', { nodeId });
  const [x1, y1, , , x3, y3] = model.border;
  return { x: (x1 + x3) / 2, y: (y1 + y3) / 2 };
}

// ---------- launch / teardown ----------

function findBrowser() {
  if (process.env.TYPE_RIGHT_BROWSER) return process.env.TYPE_RIGHT_BROWSER;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) die('Microsoft Edge not found. Set TYPE_RIGHT_BROWSER to a Chromium that honours --load-extension (branded Chrome 137+ does not).');
  return found;
}

/** Processes whose command line names our throwaway profile: exactly the ones launch started. */
function profileProcesses(profile, browserPath) {
  try {
    const ps = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '${path.basename(browserPath)}' -and $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } | ForEach-Object { $_.ProcessId }`;
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
      .split(/\s+/).filter(Boolean).map(Number).filter((pid) => pid !== process.pid);
  } catch {
    return [];
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function launch() {
  if (process.platform !== 'win32') die('verify.mjs runs on Windows only (Edge paths and the PowerShell process sweep).');
  if (fs.existsSync(STATE_FILE)) {
    die(`An instance is already recorded in ${STATE_FILE}. Run \`doctor\` to check it, or \`cleanup\` first.`);
  }
  const edgePath = findBrowser();
  console.log('Building (npm run build)...');
  execSync('npm run build', { stdio: ['ignore', 'ignore', 'inherit'], cwd: ROOT });

  fs.mkdirSync(RUN_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = path.join(VERIFY_DIR, 'evidence', stamp);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'type-right-verify-'));
  // Saved after every process starts, so `cleanup` can stop whatever a failed launch left behind.
  const state = { profile, edgePath, evidenceDir, dark: bool('dark'), extId: null, startedAt: new Date().toISOString() };
  const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  save();
  try {
    await start(state, save);
  } catch (error) {
    console.error(`Launch failed: ${error.message ?? error}\nCleaning up what it started...`);
    await cleanup();
    process.exit(1);
  }
  out(state, 'launch', { ready: true, testPage: state.testPage, extId: state.extId, evidenceDir: path.relative(ROOT, evidenceDir) });
}

async function start(state, save) {
  const portFile = path.join(RUN_DIR, 'server-port');
  fs.rmSync(portFile, { force: true });
  const server = spawn(process.execPath, [SCRIPT, 'serve', portFile], { detached: true, stdio: 'ignore', windowsHide: true, cwd: ROOT });
  server.unref();
  state.serverPid = server.pid;
  save();
  state.serverPort = Number(await until('the test page server', async () => fs.readFileSync(portFile, 'utf8')));
  const testPage = (state.testPage = `http://127.0.0.1:${state.serverPort}/`);
  save();

  const { profile, edgePath } = state;
  const edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-automation',
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--window-size=1280,900',
    ...(state.dark ? ['--force-dark-mode'] : []),
    testPage,
  ], { detached: true, stdio: 'ignore', windowsHide: true });
  edge.unref();
  state.edgePid = edge.pid;
  save();

  const [cdpPort, cdpPath] = (await until('Edge DevTools port', async () => fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'))).trim().split('\n');
  state.cdpPort = Number(cdpPort);
  state.cdpPath = cdpPath;
  save();

  const cdp = await browser(state);
  try {
    const sw = await until('the extension service worker', async () => (await targets(cdp)).find((t) => t.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(t.url)));
    state.extId = new URL(sw.url).host;
    save();
    // Ready = the content script attached an overlay to every textarea on the test page.
    const page = await tab(cdp, state, testPage);
    await until('overlays on every test page textarea', async () =>
      page.eval(`document.querySelectorAll('textarea').length > 0 && document.querySelectorAll('[data-type-right-overlay]').length === document.querySelectorAll('textarea').length`));
  } finally {
    cdp.close();
  }
}

async function cleanup() {
  if (!fs.existsSync(STATE_FILE)) return console.log('Nothing to clean up.');
  const state = readState();
  if (state.cdpPort) {
    try {
      const cdp = await browser(state);
      await cdp.send('Browser.close').catch(() => {});
      cdp.close();
    } catch {
      // Already gone; the profile sweep below catches stragglers.
    }
  }
  await until('Edge to exit', async () => profileProcesses(state.profile, state.edgePath).length === 0, 10000).catch(() => {
    for (const pid of profileProcesses(state.profile, state.edgePath)) {
      try { process.kill(pid); } catch {}
    }
  });
  if (alive(state.serverPid)) process.kill(state.serverPid);
  if (state.stubPid && alive(state.stubPid)) process.kill(state.stubPid);
  await sleep(500);
  fs.rmSync(state.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  record(state, { command: 'cleanup', result: 'stopped Edge and the test page server' });
  console.log(`Cleaned up. Evidence kept in ${path.relative(ROOT, state.evidenceDir)}`);
}

function serve(portFile) {
  const server = createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.slice(1).split('?')[0]);
    const file = path.join(TEST_PAGE_DIR, name);
    if (!file.startsWith(TEST_PAGE_DIR) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  });
  server.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(server.address().port)));
}

/**
 * Answers the service worker's LLM requests from `repliesFile` ({ sentence: entries shaped as
 * the prompt asks for them }; any other sentence gets none), so the LLM leg runs without a real
 * key. Re-attaches whenever MV3 restarts the worker.
 */
async function stubServe(repliesFile) {
  const state = readState();
  const replies = JSON.parse(fs.readFileSync(repliesFile, 'utf8'));
  const cdp = await browser(state);
  let attached;
  cdp.on('Target.detachedFromTarget', ({ sessionId }) => {
    if (sessionId === attached) attached = undefined;
  });
  cdp.on('Fetch.requestPaused', async ({ requestId, request }, sessionId) => {
    const body = JSON.parse(request.postData ?? '{}');
    const sentence = body.messages?.findLast((m) => m.role === 'user')?.content ?? '';
    const prompt = body.messages?.find((m) => m.role === 'system')?.content ?? '';
    const content = JSON.stringify({ errors: replies[sentence] ?? [] });
    const completion = JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
    record(state, { command: 'stub-llm answered', result: { url: request.url, sentence, promptAsksForTranslation: prompt.includes('"translation"'), content } });
    await cdp.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(completion).toString('base64'),
    }, sessionId).catch(() => {});
  });
  for (;;) {
    if (!attached) {
      const info = (await targets(cdp).catch(() => [])).find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${state.extId}/`));
      if (info) {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        await cdp.send('Fetch.enable', { patterns: LLM_URL_PATTERNS.map((urlPattern) => ({ urlPattern, requestStage: 'Request' })) }, sessionId);
        attached = sessionId;
      }
    }
    await sleep(200);
  }
}

// ---------- doctor ----------

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else if (!entry.name.endsWith('.test.ts')) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

async function doctor() {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ check: name, ok, detail });
  if (!fs.existsSync(STATE_FILE)) {
    console.log(JSON.stringify([{ check: 'instance recorded', ok: false, detail: 'run launch' }], null, 2));
    process.exit(1);
  }
  const state = readState();
  check('instance recorded', true, path.relative(ROOT, STATE_FILE));

  const built = fs.existsSync(path.join(EXT_DIR, 'manifest.json')) ? fs.statSync(path.join(EXT_DIR, 'manifest.json')).mtimeMs : 0;
  const source = Math.max(newestMtime(path.join(ROOT, 'entrypoints')), newestMtime(path.join(ROOT, 'lib')));
  check('build newer than source', built >= source, built >= source ? 'ok' : 'source changed since launch built it: cleanup + launch');

  const page = await fetch(state.testPage).then((r) => r.text()).catch(() => '');
  check('test page served', page.includes('Type Right'), state.testPage);

  let cdp;
  try {
    cdp = await browser(state);
    const { arguments: args } = await cdp.send('Browser.getBrowserCommandLine');
    check('CDP port is our Edge', args.some((a) => a.includes(state.profile)), `port ${state.cdpPort}`);
    const sw = await serviceWorker(cdp, state);
    const version = sw && (await sw.eval('chrome.runtime.getManifest().version').catch(() => undefined));
    check('extension service worker', Boolean(version), version ? `${state.extId} v${version}` : 'not running (it may be asleep; any check message wakes it)');
    const t = await tab(cdp, state, state.testPage);
    const counts = await t.eval(`[document.querySelectorAll('textarea').length, document.querySelectorAll('[data-type-right-overlay]').length]`);
    check('content script attached', counts[0] > 0 && counts[0] === counts[1], `${counts[1]} overlays / ${counts[0]} textareas`);
  } catch (error) {
    check('CDP reachable', false, String(error.message ?? error));
  } finally {
    cdp?.close();
  }

  const lt = await fetch('https://api.languagetool.org/v2/languages').then((r) => r.ok).catch(() => false);
  check('LanguageTool API reachable', lt, 'https://api.languagetool.org');

  console.log(JSON.stringify(checks, null, 2));
  if (checks.some((c) => !c.ok)) process.exit(1);
}

// ---------- commands ----------

async function withTab(fn) {
  const state = readState();
  const cdp = await browser(state);
  try {
    return await fn(state, cdp);
  } finally {
    cdp.close();
  }
}

const field = () => Number(flag('field', '0'));

const commands = {
  launch,
  cleanup,
  doctor,
  serve: () => serve(argv[0]),
  'stub-serve': () => stubServe(argv[0]),

  'stub-llm': () => {
    const state = readState();
    const file = path.resolve(argv[0] ?? die('stub-llm <replies.json>'));
    if (state.stubPid && alive(state.stubPid)) die('stub-llm is already running; cleanup stops it.');
    JSON.parse(fs.readFileSync(file, 'utf8'));
    const stub = spawn(process.execPath, [SCRIPT, 'stub-serve', file], { detached: true, stdio: 'ignore', windowsHide: true, cwd: ROOT });
    stub.unref();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, stubPid: stub.pid }, null, 2));
    out(state, `stub-llm ${file}`, { stubbing: LLM_URL_PATTERNS });
  },
  help: usage,

  tabs: () => withTab(async (state, cdp) => {
    const list = (await targets(cdp)).filter((t) => t.type === 'page').map((t) => t.url);
    out(state, 'tabs', list);
  }),

  open: () => withTab(async (state, cdp) => {
    const what = argv[0] ?? die('open <options|popup|consent|url>');
    const url = EXT_PAGES.includes(what) ? `chrome-extension://${state.extId}/${what}.html` : what;
    await cdp.send('Target.createTarget', { url });
    await sleep(800);
    out(state, `open ${what}`, { opened: url });
  }),

  close: () => withTab(async (state, cdp) => {
    const match = argv[0] ?? die('close <options|popup|consent|url substring>');
    const resolved = EXT_PAGES.includes(match) ? `chrome-extension://${state.extId}/${match}.html` : match;
    const closed = (await targets(cdp)).filter((t) => t.type === 'page' && t.url.includes(resolved));
    for (const t of closed) await cdp.send('Target.closeTarget', { targetId: t.targetId });
    out(state, `close ${match}`, { closed: closed.map((t) => t.url) });
  }),

  popup: () => withTab(async (state, cdp) => {
    // The toolbar Popup, opened over the test page so its "This page" section reads that tab.
    const page = await tab(cdp, state, state.testPage);
    await page.send('Page.bringToFront');
    const sw = (await serviceWorker(cdp, state)) ?? die('Service worker not running.');
    const opened = await sw.eval(`chrome.action.openPopup().then(() => 'ok', (e) => e.message)`);
    if (opened !== 'ok') die(`openPopup failed: ${opened}`);
    await sleep(800);
    out(state, 'popup', { opened: 'toolbar Popup; address it with --tab popup' });
  }),

  type: () => withTab(async (state, cdp) => {
    const selector = flag('selector');
    const n = field();
    const clear = bool('clear');
    const text = (argv[0] ?? die('type <text>')).replace(/\\n/g, '\n');
    const page = await tab(cdp, state);
    if (selector) {
      const { root } = await page.send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) die(`No element matches ${selector}`);
      await page.send('DOM.scrollIntoViewIfNeeded', { nodeId });
      const { x, y } = await centerOf(page, nodeId);
      await mouseClick(page, x, y);
    } else {
      await page.eval(`${FIELD_JS(n)}?.scrollIntoView({ block: 'center' })`);
      const p = await probe(page, n);
      await mouseClick(page, p.field.x, p.field.y);
    }
    if (clear) {
      await key(page, { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, commands: ['selectAll'] }, 2);
      await key(page, { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    } else {
      await key(page, { key: 'End', code: 'End', windowsVirtualKeyCode: 35, commands: ['moveToEndOfDocument'] }, 2);
    }
    await typeText(page, text);
    if (!selector) {
      out(state, `type ${JSON.stringify(text)} --field ${n}${clear ? ' --clear' : ''}`, { value: (await probe(page, n)).value });
      return;
    }
    // A password field reports only its length, so a real API key never reaches log.jsonl.
    const typed = await page.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      return el.type === 'password' ? { length: el.value.length } : { value: el.value };
    })()`);
    const shown = typed.length === undefined ? JSON.stringify(text) : `<${text.length} chars>`;
    out(state, `type ${shown} --selector ${selector}${clear ? ' --clear' : ''}`, typed);
  }),


  press: () => withTab(async (state, cdp) => {
    const name = argv[0] ?? die(`press <${Object.keys(NAMED_KEYS).join('|')}>`);
    const def = NAMED_KEYS[name] ?? die(`Unknown key "${name}". Known: ${Object.keys(NAMED_KEYS).join(', ')}`);
    const page = await tab(cdp, state);
    await key(page, def);
    await sleep(200);
    const focused = await page.eval(`(() => { const e = document.activeElement; return e && { name: e.name, value: e.type === 'password' ? '(hidden)' : e.value }; })()`);
    out(state, `press ${name} --tab ${page.url}`, { focused });
  }),

  value: () => withTab(async (state, cdp) => {
    const n = field();
    out(state, `value --field ${n}`, { value: (await probe(await tab(cdp, state), n)).value });
  }),

  slips: () => withTab(async (state, cdp) => {
    const n = field();
    const waitFor = flag('wait');
    const timeout = Number(flag('timeout', '15000'));
    const page = await tab(cdp, state);
    let p = await probe(page, n);
    if (waitFor !== undefined) {
      p = await until(`an underline on "${waitFor}"`, async () => {
        const now = await probe(page, n);
        return now.slips.some((s) => s.text === waitFor) && now;
      }, timeout).catch((error) => die(`${error.message}\nUnderlines now: ${JSON.stringify(p.slips.map((s) => s.text))}`));
    }
    out(state, `slips --field ${n}${waitFor ? ` --wait ${waitFor}` : ''}`, p.slips.map(({ text, kind }) => ({ text, kind })));
  }),

  badge: () => withTab(async (state, cdp) => {
    const n = field();
    out(state, `badge --field ${n}`, (await probe(await tab(cdp, state), n)).badge);
  }),

  hover: () => withTab(async (state, cdp) => {
    const n = field();
    const text = argv[0] ?? die('hover <underlined text>');
    const page = await tab(cdp, state);
    const slip = (await probe(page, n)).slips.find((s) => s.text === text) ?? die(`No underline on "${text}".`);
    await mouseMove(page, slip.x - 1, slip.y);
    await mouseMove(page, slip.x, slip.y);
    const card = await until('the Hover card', () => readCard(page), 3000).catch(() => null);
    out(state, `hover ${JSON.stringify(text)} --field ${n}`, cardView(card) ?? 'no Hover card opened');
  }),

  card: () => withTab(async (state, cdp) => {
    out(state, 'card', cardView(await readCard(await tab(cdp, state))) ?? 'no Hover card open');
  }),

  'click-card': () => withTab(async (state, cdp) => {
    const label = argv[0] ?? die('click-card <button text>');
    const page = await tab(cdp, state);
    const card = (await readCard(page)) ?? die('No Hover card open: run hover first.');
    const button = card.buttons.find((b) => b.label === label) ?? die(`No "${label}" button. Buttons: ${card.buttons.map((b) => b.label).join(', ')}`);
    const { x, y } = await centerOf(page, button.nodeId);
    await mouseClick(page, x, y);
    await sleep(300);
    out(state, `click-card ${JSON.stringify(label)}`, { card: cardView(await readCard(page)) ?? 'closed' });
  }),

  click: () => withTab(async (state, cdp) => {
    const selector = argv[0] ?? die('click <css selector>');
    const page = await tab(cdp, state);
    const { root } = await page.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) die(`No element matches ${selector}`);
    await page.send('DOM.scrollIntoViewIfNeeded', { nodeId });
    const { x, y } = await centerOf(page, nodeId);
    await mouseClick(page, x, y);
    await sleep(300);
    out(state, `click ${selector} --tab ${page.url}`, 'clicked');
  }),

  screenshot: () => withTab(async (state, cdp) => {
    const name = argv[0] ?? die('screenshot <name>');
    const page = await tab(cdp, state);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(state.evidenceDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    out(state, `screenshot ${name} --tab ${page.url}`, { saved: path.relative(ROOT, file) });
  }),

  eval: () => withTab(async (state, cdp) => {
    const page = await tab(cdp, state);
    out(state, `eval ${argv[0]}`, await page.eval(argv[0] ?? die('eval <js>')));
  }),

  'sw-eval': () => withTab(async (state, cdp) => {
    const sw = (await serviceWorker(cdp, state)) ?? die('Service worker not running; open the test page and type to wake it.');
    out(state, `sw-eval ${argv[0]}`, await sw.eval(argv[0] ?? die('sw-eval <js>')));
  }),
};

const run = commands[cmd];
if (!run) {
  usage();
  process.exit(cmd ? 1 : 0);
}
await Promise.resolve(run()).catch((error) => die(error.stack ?? String(error)));
