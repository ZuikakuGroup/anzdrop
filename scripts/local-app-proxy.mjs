import http from 'node:http';

// Test preview only: stream requests/responses without modifying cookies or bodies.
// Preserve Host so API same-origin checks see the browser's localhost Origin.
const server = http.createServer((request, response) => {
  const api = request.url === '/api' || request.url.startsWith('/api/');
  const upstream = http.request({ hostname: '127.0.0.1', port: api ? 8791 : 4324, path: request.url, method: request.method, headers: request.headers }, result => {
    response.writeHead(result.statusCode, result.headers);
    result.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
});
server.listen(3310, 'localhost');
