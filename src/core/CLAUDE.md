# core/（土台：色・マテリアル・物理・波・ワールドコマンド・セーブ）

ゲーム全体で使う土台。ここのファイルはほかのどのフォルダからも読まれるので、形を変えるときは使っている側もまとめて直す。

> **このフォルダのファイルを追加・削除・変更したら、この CLAUDE.md の内容も合わせて見直し、必要なら書き換えること。**
> ルートの `CLAUDE.md` のフォルダ構成の表に関わる変更（ファイルの役割が変わる、など）なら、そちらも直す。

## ファイル

| ファイル | 中身 |
|---|---|
| `palette.ts` | `PALETTE`。**色はここにある色だけを使う**（UI の濃い文字色・縁取りの `#2b2633` は例外） |
| `materials.ts` | ローポリ用のフラットシェーディングのマテリアル（`flat()`・`flatVertex()`・`flatTransparent()`・`solid()`） |
| `physics.ts` | Rapier のラッパー `Physics`。`GRAVITY`・`WATER_LEVEL`、浮力・水の抵抗、衝突グループ `COLLIDE`、凸包コライダーを作る `hullDesc()`。今いない場所の剛体は `physics.park()` で止める |
| `waves.ts` | 海の波の式。水面のシェーダー（`WAVE_GLSL`）と CPU 側の浮力・泳ぎ（`waveOffset()`）で**同じ式**を使う。嵐では `setWaveScale()` で波を高くする |
| `commands.ts` | ワールドコマンドの型。入力側が作る「頼み」（`WorldRequest`）と、ホストが確かめて ID などを決めた「コマンド」（`WorldCommand`） |
| `save.ts` | ワールドのセーブ（localStorage）。`WorldData` の形、`SAVE_VERSION` と版ごとの変換、`listWorlds`・`createWorld`・`loadWorld`・`saveWorld`・`deleteWorld` |

## ワールドコマンドの流れ（`commands.ts`）

1. 入力側（`actions/` など）は `WorldRequest` を作って `request(req)` を呼ぶだけ
2. 各クラスの `authorize(req)` が確かめ、ホストが決める値（`pid`・`did`・`bid`・`sid`・`hid` などの通し番号、採れる物、刺さる位置）を入れて `WorldCommand` にする。だめなら `null`
3. 各クラスの `apply(cmd)` が、コマンドの中の ID と値だけで世界を変える（カメラや入力を見ない）
4. 振り分けは `main.ts` の `requestWorld()` / `applyWorld()`

新しいコマンドを足すときは：

- `commands.ts` にコマンドの型と、ホストが決める値を除いた頼みの型を足し、`WorldCommand`・`WorldRequest` の和に入れる
- 担当クラスに `authorize()` と `apply()` を作り、`main.ts` の `requestWorld()`・`applyWorld()` と `xxx.request = requestWorld` に足す
- ID はホストが発行する通し番号にする（配列の位置やオブジェクトへの参照を使わない）

## 物理（`physics.ts`）

- 衝突グループは `COLLIDE` にまとめる。新しい種類の物や問い合わせを足すときは、何とぶつかるかをコメントに書いてここに足す
- 物理で動く物（丸太・落とし物）はマルチではホストだけが計算する。Rapier の結果はブラウザごとにずれるので、共有の結果を各自の物理で決めない

## セーブ（`save.ts`）

- 地形や木・茂みの配置は固定シードで毎回同じに作るので、セーブには**変化した状態だけ**を入れる
- 共有ワールドのクラスは `serialize()` / `restore()` を持ち、`main.ts` の `snapshot()` / `restore()` に入れる。`snapshot()` はマルチの途中参加で送る「世界のまるごとの状態」にも使う
- 時間で変わる物（生え直し・ひとりでに埋まる穴など）は経過時間もセーブに入れる
- **セーブデータの形を変えたら `SAVE_VERSION` を上げ**、ファイル先頭の版の一覧に「N → N+1：何が変わったか」を1行足し、`loadWorld()` で古いデータを変換するか読めないことを知らせる
- localStorage はオリジン（ポート番号）ごとに別なので、URL が変わると前のワールドは見えなくなる
