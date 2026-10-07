import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixtureUrl = new URL('./fixtures/local-first-reading.html', import.meta.url);

export default async function globalSetup() {
  const content = await readFile(fileURLToPath(fixtureUrl));
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost:8765').pathname;
    if (pathname !== '/local-first-reading.html') {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(content);
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(8765, '127.0.0.1', done);
  });
  return async () => {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  };
}
