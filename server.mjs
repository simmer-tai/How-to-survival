// 手元で遊ぶ・作業するときのローカルサーバー。このフォルダのファイル（index.html・js/ など）を配るだけ。
//   node server.mjs        （ポートを変えるなら node server.mjs 8800）
// index.html をダブルクリックで開く（file://）と、ブラウザの決まりで js のモジュールを読み込めないので、これで開く。
// マルチプレイはブラウザ同士が PeerJS で直接つなぐので、このサーバーは関わらない（公開は GitHub Pages で行う）。
// 追加のインストールはいらない（Node.js の標準機能だけで動く）

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8765); // 今までと同じポートにすると、ワールドのセーブがそのまま見える
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  // このフォルダの外と、.git などの隠しファイル・node_modules は配らない
  const inside = path.relative(ROOT, file);
  if (inside.startsWith('..') || path.isAbsolute(inside) || inside.split(path.sep).some((part) => part.startsWith('.') || part === 'node_modules')) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('見つかりません');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache', // ビルドし直したら、読み込み直すだけで新しいものになるように
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`ポート ${PORT} はもう使われています。ほかのサーバーを止めるか、node server.mjs 8800 のように別のポートで起動してください。`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Island のローカルサーバーを起動しました： http://localhost:${PORT}/ （止めるときは Ctrl+C）`);
});
