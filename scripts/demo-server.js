'use strict';

var http = require('node:http');
var fs = require('node:fs');
var path = require('node:path');

var ROOT = path.resolve(__dirname, '..', 'PrBinView');
var PORT = Number(process.env.PORT) || 4190;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

var server = http.createServer(function (req, res) {
  var cleanUrl = String(req.url || '/').split('?')[0];
  var rel = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
  var full = path.resolve(ROOT, rel);
  if (full.indexOf(ROOT) !== 0) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(full, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    var ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('PrBinView 浏览器界面演示已启动：http://127.0.0.1:' + PORT);
  console.log('按 Ctrl+C 停止服务。');
});
