// ビルドした日時を src/buildInfo.ts に書き込む（npm run build で tsc の前に動く）。
// タイトル画面に「いつの版か」を出し、公開ページの版と比べて新しい版が出ていれば知らせるのに使う。
// 追加のインストールはいらない（Node.js の標準機能だけで動く）

import fs from 'node:fs';

const TIME_ZONE = 'Asia/Tokyo'; // 日時を出すときの時間帯

const parts = Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]),
);
const stamp = `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
fs.writeFileSync(
  new URL('./src/buildInfo.ts', import.meta.url),
  `// npm run build のたびに stamp.mjs が書き換える（手で直さない）\n/** ビルドした日時（日本時間） */\nexport const BUILT_AT = '${stamp}';\n`,
);
console.log(`ビルドの日時: ${stamp}`);
