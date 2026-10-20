import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(new URL('..', import.meta.url).pathname);
const port = Number(process.env.PORT || 4173);
http
  .createServer(async (req, res) => {
    try {
      const path = resolve(
        root,
        '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname),
      );
      if (path !== root && !path.startsWith(root + sep)) throw new Error('Invalid path');
      const file = path === root || path.endsWith(sep) ? resolve(path, 'index.html') : path;
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json',
            '.svg': 'image/svg+xml',
          }[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Recall: http://127.0.0.1:${port}`));
