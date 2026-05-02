'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8082;
const API_URL = process.env.API_URL || 'https://api.joseph101039.uk';

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // api.js 的第一行換成環境變數指定的 URL
    if (filePath.endsWith('api.js')) {
      data = Buffer.from(
        data.toString().replace(
          /^const GAS_URL = .+/m,
          `const GAS_URL = '${API_URL}';`
        )
      );
    }

    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html') {
      // Google Sign-In popup 需要 same-origin-allow-popups 才能 postMessage 回主頁
      headers['Cross-Origin-Opener-Policy'] = 'same-origin-allow-popups';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`UI dev server: http://localhost:${PORT}  (API_URL=${API_URL})`);
});
