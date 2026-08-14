'use strict';
// 自测用的假 Harness 后端：起一个最小 HTTP 服务
const http = require('http');

const port = Number(process.env.HARNESS_FAKE_PORT || 3080);
http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><html><head><title>Fake Harness</title></head>' +
    '<body style="background:#0b0f19;color:#e5e7eb;font-family:sans-serif;' +
    'display:flex;align-items:center;justify-content:center;height:100vh">' +
    '<h1>Fake Harness backend OK</h1></body></html>');
}).listen(port, '127.0.0.1', () => {
  console.log(`fake harness listening on http://127.0.0.1:${port}`);
});
