# player/（プレイヤーの移動・体力・手・体）

プレイヤー自身にかかわるもの。ここの状態はすべて**自分だけ**（マルチでは、他の人に見せる位置・見た目・ポーズだけを送る）。

> **このフォルダのファイルを追加・削除・変更したら、この CLAUDE.md の内容も合わせて見直し、必要なら書き換えること。**
> ルートの `CLAUDE.md` のフォルダ構成の表や「アイテムを追加するとき」の節に関わる変更なら、そちらも直す。

## ファイル

| ファイル | 中身 |
|---|---|
| `player.ts` | 移動・泳ぎ・視点（`Player`）。`STEP_HEIGHT`（0.5m）以下の段差は歩いたまま上る（Rapier の autostep に加え、引っかかったときは `stepUp()` で段の上へ持ち上げる）。セーブは位置・向き・乗っている船（`boat`）・いる場所（`loc`）。`Player.pose()` で体の動き `AvatarPose` を返す |
| `vitals.ts` | HP・空腹・水分（`Vitals`） |
| `hand.ts` | 一人称の手。道具のモデル（`buildAxe()`・`buildHammer()`・`buildStoneKnife()`・`buildSpear()`・`buildPickaxe()`・`buildShovel()`・`buildHoe()`・`buildFishingRod()` など）、振る動き（`SwingMotion`）、道具を持つ `ToolHand`、素材や食べ物を持つ `ItemHand`（持ち方は `HOLD_STYLES`）、素手の `EmptyHand`（左手に物を持つと `leftHolding` で右のこぶしだけになる）。`ToolHand` は `drawFlip` にすると、持ち替えたときに道具を放り上げて一回転させて受け止める（石の斧・ハンマー・ツルハシ。自分の画面だけの演出）。`ToolHand`・`ItemHand` は `toLeft()` で左右反転して左手に持たせる（左手のマスの物。左手では振らない）。手は `VIEW_LAYER` に描く |
| `handSway.ts` | 手元の揺れ（`HandSway`）。カメラの子の台 `root` を、歩く・走る足取り（頭の揺れと同じ位相）・跳ぶ・着地・横移動・視点を回す動きに合わせてばねでなめらかに動かす。一人称の手や持ち物はすべてカメラでなくこの台の子にする。体の動きは `Player.sway()` から受け取る。自分の画面だけの演出 |
| `handModel.ts` | ローポリの右手（スキンメッシュ）と指のポーズ（`HAND_POSES`） |
| `avatar.ts` | 自分の体（`Avatar`）。見た目 `AvatarLook` はワールドでなくブラウザに保存する（`loadLook()`・`saveLook()`）。動きは `AvatarPose` から決める。持ち物は `setHeld(item, side)` で右手（0）と左手（1）に持たせる。一人称では影だけ（`AVATAR_LAYER`）、V で三人称にすると姿が見える。マルチでは他の人の体もこれで描き（`others.ts`）、見た目と様子（`net/protocol.ts` の `PoseMsg`）を送る。届いた見た目は `toLook()` で確かめる。`AvatarPose` の `state` が `down`（力尽きた）になると、`ragdoll.ts` のラグドールで崩れ落ち、ほかの状態に戻ると関節を元に戻して立つ。マルチでも `PoseMsg` の `state` で届くので、ほかの人の画面でも倒れる |
| `ragdoll.ts` | 力尽きた体のラグドール（`Ragdoll`）。関節を点にして、長さを保ちながら重力で落とすベルレ積分（胴体は曲がらない箱、肘・膝は折りたたみすぎない）。点は地面（建てた床・桟橋も）より下へ沈まず、水の中では浮く。地面と水面の高さは `main.ts` が `setRagdollEnv()` で決める（Rapier の剛体は使わないので、落とし物などの物理に混ざらない）。点の位置からアバターの関節の向きを決め直し、`SETTLE_TIME` たつと止まる。見た目だけの演出で、各自の画面で計算する（同期・セーブしない） |
| `others.ts` | マルチで同じ部屋にいるほかの人の体と名札（`OtherPlayers`）。体は `Avatar`（レイヤー 0）で描き、届いた様子（`PoseMsg`）へなめらかに寄せる。自分と違う場所にいる人は描かない。地図に描く位置は `spots()` |
| `torchLight.ts` | 手に持った松明の明かり（`TorchLights`）。自分と、同じ場所にいるほかの人の松明の炎の位置（`Avatar.torchFlames()`・`OtherPlayers.torchFlames()`。両手に持てば2つ）に置く。明かりの数が変わるとシェーダーを作り直して止まるので、決まった数の明かりをいつも置き、使わないものは強さを 0 にする。自分の画面だけの演出 |
| `bodyParts.ts` | 人の体の部品（関節・箱・手足・頭など）。住人（`world/npc.ts`）とアバターで共通 |

## 書くときの決まり

- **新しいアイテムは手に持って見えるようにする**（お金 `currency: true` だけは例外）
  - 振る道具は `hand.ts` に `buildXxx()` を作り、`main.ts` で `ToolHand` にする
  - 素材・食べ物は `ItemHand` で持たせ、`main.ts` の `materialHands` に足す
  - 見た目は `items/itemModels.ts`・`items/itemIcons.ts` の形とそろえる
- 体の部品を変えるときは、住人（`world/npc.ts`）とアバターの両方の見た目を確かめる
- `AvatarLook` や `AvatarPose` の形を変えると、マルチで送る中身も変わる。足すときはどちらも小さなデータのままにする
- `PlayerSave`・`VitalsSave` の形を変えたら `core/save.ts` の `SAVE_VERSION` を上げる（`AvatarLook` はワールドのセーブではないので別）
