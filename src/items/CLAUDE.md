# items/（アイテム・インベントリ・レシピ・取引・落とし物）

アイテムの定義と見た目、インベントリ、クラフトと建築のレシピ、設計図で覚えたレシピ、取引の内容、地面に落ちている物。

> **このフォルダのファイルを追加・削除・変更したら、この CLAUDE.md の内容も合わせて見直し、必要なら書き換えること。**
> ルートの `CLAUDE.md` のフォルダ構成の表や「アイテムを追加するとき」の節に関わる変更なら、そちらも直す。

## ファイル

| ファイル | 中身 | 状態の種類 |
|---|---|---|
| `inventory.ts` | アイテムの定義 `ITEMS`（名前・`maxStack`・`durability`・`currency`・設計図の `teaches` など）と `Inventory`。スタック `Stack` は使いかけの道具の減った耐久値を `dmg` に、島の地図の中身を `chart` に持つ（スタックを作るときは `makeStack()` で、正しい値だけを持たせる）。白紙の地図の id は前の「地図」の `map` のまま。お金は「お金のマス」（`purse`）にだけ入る。お金のマスは自分の枠に入れ、カバンの3段目の左に `PURSE_GAP` だけ離して置く。ホットバーと左手のマスはいつも見えるので、カバンのマス（52）より大きい `HOTBAR_SLOT` の大きさで描く。ホットバーの左に離して「左手のマス」（`offhand`。`offhandStack`）があり、入れた物はいつも左手に持つ（拾った物は左手の同じ物にも積むが、空の左手のマスには自動で入れない。`count`・`remove` は左手の物も数える）。開いている画面の欄（焚火の燃料の欄など）へ Shift+クリックで送るときは `quickMove` を使う。開いている間は、カバンの欄（お金のマス・ゴミ箱も。ホットバーは動かさない）がマウスカーソルのほうへ少し傾く（`TILT_GAIN`・上限 `TILT_MAX`・`TILT_PERSPECTIVE`・`TILT_EASE`。自分の画面だけの演出）。カーソルを合わせたマスは少し手前に出る（`HOVER_LIFT`・`HOVER_SCALE`・`HOVER_EASE`）。枠はすりガラス風（`GLASS_*`。ホットバーと左手の枠だけ後ろの景色を `backdrop-filter` でぼかす。カバンの欄はマスが手前に出る奥行きを保つためにぼかさず、開いている間は `main.ts` が背景の世界そのものをぼかす） | 自分だけ |
| `recipes.ts` | クラフトのレシピ `RECIPES`（作る場所 `Station`：手元・作業台・製図台、`locked` は設計図で覚えるまで作れない。今は船・ツルハシ・槍・ハンマー・釣り竿・製図台。島の地図は決まったレシピでなく、`actions/crafting.ts` が製図台で候補を出す。製図台では島の地図しか作れず、`recipesAt('draftingTable')` は空）と、建築部材に使う素材 `BUILD_PLANS` | — |
| `recipeBook.ts` | 設計図で覚えたレシピ（`RecipeBook`）。設計図を持って右クリックで覚え、設計図は1枚なくなる（もう覚えていたら減らない） | 自分だけ |
| `trades.ts` | 住人ごとの取引の一覧 `TRADES`（`MerchantId`：`pier`・`farmer`・`mapmaker`。農家は木の種とくわの設計図、地図売りは白紙の地図・製図台の設計図・地形のメモを売る）。住人は在庫を持たず、自分のインベントリだけが変わる | 自分だけ |
| `drops.ts` | 落ちている物（`ItemDrops`）。自分の島と、海図に載せた島ごとに1つずつある（島のものは `at = { loc }` で、コマンドに島が入る）。落とす・拾うはワールドコマンド（`dropItem`・`pickDrop`）。物理で動くので、マルチではその場所の物理の担当が計算した位置（`motion()`）をほかの人に配る（`setMotion()`） | 共有 |
| `landInfo.ts` | 地形のメモ。地形の種類 `LAND_KINDS` とメモでの呼び名 `LAND_NAMES`（木々の海・風の原・白い渚・灰の牙・空を映す水・切り立つ岸・激流・笹・船喰い・水流・空洞）。アイテムの id は `forestInfo` のように `${地形}Info`（`landInfoId()`）。地図屋で買う。製図台で白紙の地図と組み合わせて島の地図にする | — |
| `islandChart.ts` | 島の地図の中身。種（seed）と組み合わせたメモ（told）を1つの整数 `chart` にまとめる（`newChart()`・`validChart()`）。本当に島にある地形（lands）と島の名前は、`readChart()` が seed と told からいつも同じ計算で決める。メモの地形はかならず全部出る。メモにない地形がときどき混ざり、メモの数が多いほど混ざりやすい（`EXTRA_BASE`・`EXTRA_STEP`）。メモは `CHART_MAX_TOLD`（5）種類まで。地図を作るのは自分だけの行動なので、種は作った人のブラウザで `Math.random()` で決める（釣りの魚と同じ）。混ざる見込みと lands はプレイヤーに見せない | — |
| `fishKinds.ts` | 釣れる魚の種類 `FISH_KINDS`（見た目・場所と時間・引きの強さ）。釣りは自分だけの行動なので `Math.random()` で決めてよい | — |
| `itemModels.ts` | アイテムの3Dモデル（`buildXxxModel()`）。船・魚・コイン・松明（炎は描くたびに揺れる。`TORCH_FLAME_Y` は炎の高さ。炎の舌の形・色・揺らぎ・まわりの光は `FIRE_TONGUE_GEO`・`FIRE_MATS`・`fireWobble`・`fireGlowMaterial` として焚火にも貸す）・設計図（`BlueprintKind` ごとに図面を変える）・白紙の地図・島の地図・地形のメモ（`LAND_DRAWINGS` で地形ごとに紙の絵を変える）など | — |
| `itemIcons.ts` | アイテムのアイコン（`itemIcon()`。モデルから描く）と `itemModel()` | — |

## アイテムを追加するとき

1. `inventory.ts` の `ITEMS` に足す
   - 道具は `durability` を付け、`maxStack` は 1。何かに当てて使えたときに `main.ts` の `wearTool()` で耐久値を減らす（空振りでは減らさない）
   - スタックを作り直すときは `dmg`・`chart` を引き継ぐ（`makeStack()` を使う）
   - お金は `currency: true`（ホットバーに置けず、手に持たない）
2. `itemModels.ts` にモデル、`itemIcons.ts` にアイコンを、手に持つモデルと同じ形で用意する
3. 手に持てるようにする（`player/hand.ts` の `ToolHand` か、`main.ts` の `materialHands` の `ItemHand`）。**持てないアイテムを作らない**
4. 作れるなら `recipes.ts`、買える・売れるなら `trades.ts`、食べられるなら `actions/food.ts` の `FOODS` に足す
5. 魚なら `fishKinds.ts` の `FISH_IDS`・`FISH_KINDS` に足す
6. 地形のメモなら `landInfo.ts` の `LAND_KINDS`・`LAND_NAMES` と、`inventory.ts` の `ITEMS`、`itemModels.ts` の `LAND_DRAWINGS` に足す（アイコン・手に持つ見た目・地図屋の売り物は `perLandInfo()`・`LAND_INFO_IDS` から自動で増える）

## 書くときの決まり

- クラフト・取引・覚えたレシピはインベントリ（自分だけ）の中で完結するので、ワールドコマンドにしない
- 落とし物は共有ワールド。ID（`did`）はホストが発行する通し番号。取り合いはホストが判定する
- `InventorySave`・`DropsSave`・`RecipeBookSave` の形を変えたら `core/save.ts` の `SAVE_VERSION` を上げる。アイテムの id を変える・消すときは古いセーブの変換も考える
