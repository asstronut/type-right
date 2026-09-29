import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../test-page');
const port = 5173;

const server = createServer(async (req, res) => {
  const file = req.url === '/' ? 'index.html' : req.url.slice(1);
  try {
    const body = await readFile(path.join(dir, file));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Test page: http://localhost:${port}`);
});
