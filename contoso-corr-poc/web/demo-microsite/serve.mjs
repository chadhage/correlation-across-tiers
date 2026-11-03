import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMicrosite } from './build.mjs';

export function createMicrositeServer(html) {
  const body = Buffer.from(html);
  return createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = request.url.split('?')[0];
    if (pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    if (!['/', '/index.html'].includes(pathname)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--port')) {
    throw new Error('Usage: node web\\demo-microsite\\serve.mjs [--port 4174]');
  }
  const port = args.length ? Number(args[1]) : 4174;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535');
  const { html, data } = await buildMicrosite();
  for (const receipt of Object.values(data.evidence.receipts)) {
    if (receipt.state !== 'matches') console.warn(`Recorded receipt ${receipt.state}: ${receipt.path}`);
  }
  const server = createMicrositeServer(html);
  server.on('error', error => {
    console.error(`Microsite server failed: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Microsite: http://127.0.0.1:${port}`);
    console.log('Read-only source snapshot. Environment URLs are configured in the browser; no cloud requests are made.');
  });
}
