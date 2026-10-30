import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(FIXTURES_DIR, '..', '..');
const OUT_DIR = path.join(ROOT, 'test-page', 'rich');

const FIXTURES = [
  { name: 'prosemirror', column: 'ProseMirror', entry: 'prosemirror.js', library: 'prosemirror-view' },
  { name: 'tiptap', column: 'TipTap', entry: 'tiptap.js', library: '@tiptap/core' },
  { name: 'quill', column: 'Quill', entry: 'quill.js', library: 'quill' },
  { name: 'draft', column: 'Draft', entry: 'draft.jsx', library: 'draft-js' },
  { name: 'gmail', column: 'Gmail', entry: 'gmail.js', library: null },
  { name: 'slate', column: 'Slate', entry: 'slate.jsx', library: 'slate' },
];

function installedVersion(pkg) {
  const manifest = path.join(ROOT, 'node_modules', ...pkg.split('/'), 'package.json');
  return JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
}

function pageHtml({ name, column }, hasCss) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Type Right fixture: ${column}</title>
${hasCss ? `    <link rel="stylesheet" href="${name}.css" />\n` : ''}  </head>
  <body>
    <script src="${name}.js"></script>
  </body>
</html>
`;
}

async function buildFixture(fixture) {
  const library = fixture.library
    ? { name: fixture.library, version: installedVersion(fixture.library) }
    : { name: 'none', version: 'n/a' };
  await build({
    entryPoints: [path.join(FIXTURES_DIR, fixture.entry)],
    outfile: path.join(OUT_DIR, `${fixture.name}.js`),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: false,
    jsx: 'automatic',
    legalComments: 'none',
    logLevel: 'warning',
    define: {
      'process.env.NODE_ENV': '"production"',
      global: 'window',
      __FIXTURE__: JSON.stringify({ column: fixture.column, library }),
    },
  });
  const hasCss = fs.existsSync(path.join(OUT_DIR, `${fixture.name}.css`));
  fs.writeFileSync(path.join(OUT_DIR, `${fixture.name}.html`), pageHtml(fixture, hasCss));
  return `${fixture.name} (${library.name} ${library.version})`;
}

const only = process.argv.slice(2);
const selected = only.length ? FIXTURES.filter((fixture) => only.includes(fixture.name)) : FIXTURES;
const started = Date.now();
if (!only.length) fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const built = await Promise.all(selected.map(buildFixture));
console.log(`Built ${built.length} Rich editor fixtures into ${path.relative(ROOT, OUT_DIR)} in ${Date.now() - started} ms: ${built.join(', ')}`);
