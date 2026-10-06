# player/（プレイヤーの移動・体力・手・体）

プレイヤー自身にかかわるもの。ここの状態はすべて**自分だけ**（マルチでは、他の人に見せる位置・見た目・ポーズだけを送る）。

> **このフォルダのファイルを追加・削除・変更したら、この CLAUDE.md の内容も合わせて見直し、必要なら書き換えること。**
> ルートの `CLAUDE.md` のフォルダ構成の表や「アイテムを追加するとき」の節に関わる変更なら、そちらも直す。

## ファイル

| ファイル | 中身 |
|---|---|
| `player.ts` | 移動・泳ぎ・視点（`Player`）。セーブは位置・向き・乗っている船（`boat`）・いる場所（`loc`）。`Player.pose()` で体の動き `AvatarPose` を返す |
| `vitals.ts` | HP・空腹・水分（`Vitals`） |
| `hand.ts` | 一人称の手。道具のモデル（`buildAxe()`・`buildHammer()`・`buildStoneKnife()`・`buildSpear()`・`buildPickaxe()`・`buildShovel()`・`buildFishingRod()` など）、振る動き（`SwingMotion`）、道具を持つ `ToolHand`、素材や食べ物を持つ `ItemHand`（持ち方は `HOLD_STYLES`）、素手の `EmptyHand`。手は `VIEW_LAYER` に描く |
| `handModel.ts` | ローポリの右手（スキンメッシュ）と指のポーズ（`HAND_POSES`） |
| `avatar.ts` | 自分の体（`Avatar`）。見た目 `AvatarLook` はワールドでなくブラウザに保存する（`loadLook()`・`saveLook()`）。動きは `AvatarPose` から決める。一人称では影だけ（`AVATAR_LAYER`）、V で三人称にすると姿が見える。マルチでは他の人の体もこれで描き、見た目と `AvatarPose` を送る |
| `bodyParts.ts` | 人の体の部品（関節・箱・手足・頭など）。住人（`world/npc.ts`）とアバターで共通 |

## 書くときの決まり

- **新しいアイテムは手に持って見えるようにする**（お金 `currency: true` だけは例外）
  - 振る道具は `hand.ts` に `buildXxx()` を作り、`main.ts` で `ToolHand` にする
  - 素材・食べ物は `ItemHand` で持たせ、`main.ts` の `materialHands` に足す
  - 見た目は `items/itemModels.ts`・`items/itemIcons.ts` の形とそろえる
- 体の部品を変えるときは、住人（`world/npc.ts`）とアバターの両方の見た目を確かめる
- `AvatarLook` や `AvatarPose` の形を変えると、マルチで送る中身も変わる。足すときはどちらも小さなデータのままにする
- `PlayerSave`・`VitalsSave` の形を変えたら `core/save.ts` の `SAVE_VERSION` を上げる（`AvatarLook` はワールドのセーブではないので別）
