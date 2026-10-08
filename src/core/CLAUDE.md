# core/（土台：色・マテリアル・物理・波・ワールドコマンド・セーブ）

ゲーム全体で使う土台。ここのファイルはほかのどのフォルダからも読まれるので、形を変えるときは使っている側もまとめて直す。

> **このフォルダのファイルを追加・削除・変更したら、この CLAUDE.md の内容も合わせて見直し、必要なら書き換えること。**
> ルートの `CLAUDE.md` のフォルダ構成の表に関わる変更（ファイルの役割が変わる、など）なら、そちらも直す。

## ファイル

| ファイル | 中身 |
|---|---|
| `palette.ts` | `PALETTE`。**色はここにある色だけを使う**（UI の濃い文字色・縁取りの `#2b2633` は例外） |
| `materials.ts` | ローポリ用のフラットシェーディングのマテリアル（`flat()`・`flatVertex()`・`flatTransparent()`・`solid()`）。木目のドット絵を頂点の色に重ねる `woodVertex()`（模様は明るさだけで、色は頂点の `PALETTE` の色。コードで描く 32×16 のテクスチャを1枚だけ使う。UV は 1 が `WOOD_SPAN_U` / `WOOD_SPAN_V` の長さ。近くはくっきり・遠くはミップマップでならす） |
| `physics.ts` | Rapier のラッパー `Physics`。`GRAVITY`・`WATER_LEVEL`、海の水面の高さ `seaSurface()`（`setDryZone()` で決めた海の水が来ない所＝洞窟の中では -Infinity。泳ぎ・浮力・水中の見た目はこれで調べる）、浮力・水の抵抗、衝突グループ `COLLIDE`、凸包コライダーを作る `hullDesc()`。剛体は場所ごとに止める：`within(loc, fn)` の中で作った剛体は loc の物になり、今いない場所なら作ったその場で止まる。場所を移るときは `moveTo(loc, keep)` |
| `waves.ts` | 海の波の式。水面のシェーダー（`WAVE_GLSL`）と CPU 側の浮力・泳ぎ（`waveOffset()`）で**同じ式**を使う。嵐では `setWaveScale()` で波を高くする |
| `commands.ts` | ワールドコマンドの型。木・茂み・岩・落とし物のコマンドは、海図に載せた島の物なら `loc`（`OnIsle`）を持つ。島の地図を海図に書き写す `chartIsle`。入力側が作る「頼み」（`WorldRequest`）と、ホストが確かめて ID などを決めた「コマンド」（`WorldCommand`）。頼みを出す関数の型 `Requester` |
| `graphics.ts` | 画質の設定（高・中・低の `GRAPHICS`）。解像度・縁のなめらかさ・影の解像度と描き直す間隔・霧の距離・草を描く距離・LOD の距離を段階ごとに決める。選んだ段階は**自分だけの状態**として localStorage に入れる（`loadQuality`・`saveQuality`。ワールドのセーブにもマルチの同期にも入れない）。`recommendQuality()` はグラフィックスの名前・CPU のコア数・メモリからおすすめの段階と理由を決める（設定画面に出すだけで、勝手には変えない） |
| `save.ts` | ワールドのセーブ（localStorage）。`WorldData` の形、`SAVE_VERSION` と版ごとの変換、`listWorlds`・`createWorld`・`loadWorld`・`saveWorld`・`deleteWorld`。自分だけの状態 `PersonalData` と共有ワールド `SharedWorld` の分け方。マルチの参加者の自分だけの状態（`loadGuest`・`saveGuest`。ホストのワールドの id ごと） |

## ワールドコマンドの流れ（`commands.ts`）

1. 入力側（`actions/` など）は `WorldRequest` を作って `request(req)` を呼ぶだけ。時間で起きること（穴が埋まる・燃え尽きるなど）は人でなく世界が頼むので `request(req, null)`
2. 各クラスの `authorize(req)` が確かめ、ホストが決める値（`pid`・`did`・`bid`・`sid`・`hid` などの通し番号、採れる物、刺さる位置）を入れて `WorldCommand` にする。だめなら `null`
3. 各クラスの `apply(cmd, mine)` が、コマンドの中の ID と値だけで世界を変える（カメラや入力を見ない）。`mine`（自分の頼み）なら、採れた物などを自分のインベントリに入れる
4. 振り分けは `main.ts` の `authorizeWorld()` / `applyWorld()`。頼みの送り先は `net/multiplayer.ts` の `request()`（ひとり・ホストはその場で適用し、ホストは全員に配る。参加者は手元で確かめてからホストへ送り、断られたら `main.ts` の `undoRequest()` で元に戻す）

新しいコマンドを足すときは：

- `commands.ts` にコマンドの型と、ホストが決める値を除いた頼みの型を足し、`WorldCommand`・`WorldRequest` の和に入れる
- 担当クラスに `authorize()` と `apply()` を作り、`main.ts` の `authorizeWorld()`・`applyWorld()` と `xxx.request = requestWorld` に足す
- 頼んだ人が先に持ち物を減らす頼みなら、`main.ts` の `undoRequest()` に戻し方を足す
- ID はホストが発行する通し番号にする（配列の位置やオブジェクトへの参照を使わない）

## 物理（`physics.ts`）

- 衝突グループは `COLLIDE` にまとめる。新しい種類の物や問い合わせを足すときは、何とぶつかるかをコメントに書いてここに足す
- 物理で動く物（丸太・落とし物）はマルチでは場所ごとの物理の担当（ホストがいればホスト、いなければその場所にいる人）だけが計算する（`net/multiplayer.ts`）。Rapier の結果はブラウザごとにずれるので、共有の結果を各自の物理で決めない
- 物理のワールドは1つで、場所（自分の島・街・海図に載せた島）はどれも原点のまわりに重なっている。今いない場所の剛体がぶつからないように、場所の物の剛体は `within(loc, …)` の中で作る（`main.ts` の `applyWorld()` はコマンドの場所で包む）。剛体を手で `setEnabled(true)` しない（船だけは `Boats` が場所ごとに切り替える）

## セーブ（`save.ts`）

- 地形や木・茂みの配置は固定シードで毎回同じに作るので、セーブには**変化した状態だけ**を入れる
- 共有ワールドのクラスは `serialize()` / `restore()` を持ち、`main.ts` の `sharedSnapshot()` / `restoreShared()` に入れる（自分だけの状態は `personalSnapshot()` / `restorePersonal()`）。`sharedSnapshot()` はマルチの途中参加で送る「世界のまるごとの状態」にも使う
- 時間で変わる物（生え直し・ひとりでに埋まる穴など）は経過時間もセーブに入れる
- **セーブデータの形を変えたら `SAVE_VERSION` を上げ**、ファイル先頭の版の一覧に「N → N+1：何が変わったか」を1行足し、`loadWorld()` で古いデータを変換するか読めないことを知らせる
- localStorage はオリジン（ポート番号）ごとに別なので、URL が変わると前のワールドは見えなくなる
