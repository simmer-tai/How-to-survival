# items/（アイテム・インベントリ・レシピ・取引・落とし物）

アイテムの定義と見た目、インベントリ、クラフトと建築のレシピ、設計図で覚えたレシピ、取引の内容、地面に落ちている物。

> **このフォルダのファイルを追加・削除・変更したら、この CLAUDE.md の内容も合わせて見直し、必要なら書き換えること。**
> ルートの `CLAUDE.md` のフォルダ構成の表や「アイテムを追加するとき」の節に関わる変更なら、そちらも直す。

## ファイル

| ファイル | 中身 | 状態の種類 |
|---|---|---|
| `inventory.ts` | アイテムの定義 `ITEMS`（名前・`maxStack`・`durability`・`currency`・設計図の `teaches` など）と `Inventory`。スタック `Stack` は使いかけの道具の減った耐久値を `dmg` に持つ。お金は左の「お金のマス」（`purse`）にだけ入る。開いている画面の欄（焚火の燃料の欄など）へ Shift+クリックで送るときは `quickMove` を使う | 自分だけ |
| `recipes.ts` | クラフトのレシピ `RECIPES`（作る場所 `Station`：手元か作業台、`locked` は設計図で覚えるまで作れない）と、建築部材に使う素材 `BUILD_PLANS` | — |
| `recipeBook.ts` | 設計図で覚えたレシピ（`RecipeBook`）。設計図を持って右クリックで覚える（設計図は減らない） | 自分だけ |
| `trades.ts` | 住人ごとの取引の一覧 `TRADES`（`MerchantId`：`pier`・`farmer`）。住人は在庫を持たず、自分のインベントリだけが変わる | 自分だけ |
| `drops.ts` | 落ちている物（`ItemDrops`）。落とす・拾うはワールドコマンド（`dropItem`・`pickDrop`）。物理で動くので、マルチではホストの物理の位置（`motion()`）を参加者に配る（`setMotion()`） | 共有 |
| `fishKinds.ts` | 釣れる魚の種類 `FISH_KINDS`（見た目・場所と時間・引きの強さ）。釣りは自分だけの行動なので `Math.random()` で決めてよい | — |
| `itemModels.ts` | アイテムの3Dモデル（`buildXxxModel()`）。船・魚・コイン・設計図など | — |
| `itemIcons.ts` | アイテムのアイコン（`itemIcon()`。モデルから描く）と `itemModel()` | — |

## アイテムを追加するとき

1. `inventory.ts` の `ITEMS` に足す
   - 道具は `durability` を付け、`maxStack` は 1。何かに当てて使えたときに `main.ts` の `wearTool()` で耐久値を減らす（空振りでは減らさない）
   - スタックを作り直すときは `dmg` を引き継ぐ
   - お金は `currency: true`（ホットバーに置けず、手に持たない）
2. `itemModels.ts` にモデル、`itemIcons.ts` にアイコンを、手に持つモデルと同じ形で用意する
3. 手に持てるようにする（`player/hand.ts` の `ToolHand` か、`main.ts` の `materialHands` の `ItemHand`）。**持てないアイテムを作らない**
4. 作れるなら `recipes.ts`、買える・売れるなら `trades.ts`、食べられるなら `actions/food.ts` の `FOODS` に足す
5. 魚なら `fishKinds.ts` の `FISH_IDS`・`FISH_KINDS` に足す

## 書くときの決まり

- クラフト・取引・覚えたレシピはインベントリ（自分だけ）の中で完結するので、ワールドコマンドにしない
- 落とし物は共有ワールド。ID（`did`）はホストが発行する通し番号。取り合いはホストが判定する
- `InventorySave`・`DropsSave`・`RecipeBookSave` の形を変えたら `core/save.ts` の `SAVE_VERSION` を上げる。アイテムの id を変える・消すときは古いセーブの変換も考える
