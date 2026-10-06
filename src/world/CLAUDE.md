# world/（地形・海・空・天気・場所・街・住人）

島と街の場面を作るもの。地形・海・草・木や茂みや岩の配置、時刻と空、天気・雨・風、場所の切り替え、街の建物と住人。

> **このフォルダのファイルを追加・削除・変更したら、この CLAUDE.md の内容も合わせて見直し、必要なら書き換えること。**
> ルートの `CLAUDE.md` のフォルダ構成の表や「場所（島・街）」の節に関わる変更なら、そちらも直す。

## ファイル

| ファイル | 中身 | 状態の種類 |
|---|---|---|
| `terrain.ts` | 地形の高さ（`HeightField`、`islandField`）、`WORLD_SIZE`・`SEA_FLOOR`、ノイズ、砂・草の判定、地形メッシュ。`terrainHeight()` は `setActiveField()` で選んだ今いる場所の地形を返す | 固定 |
| `water.ts` | 海（`Sea`）と海底の高さのテクスチャ（`bakeSeabed()`） | 固定 |
| `grass.ts` | 草（`Grass`）。風で揺れる | 固定 |
| `props.ts` | 木・茂み・岩・桟橋の配置（固定シード）。木は `Tree`、桟橋は `buildPier()` | 配置は固定、木・茂み・岩の変化は共有（`actions/` が持つ） |
| `pebbles.ts` | 砂浜に湧く小石（`BeachPebbles`）。置いた数と時間をセーブ。置くのは世界の頼み（`dropItem`）なので、マルチではホストだけが置く | 共有 |
| `clock.ts` | ワールドの時刻（`WorldClock`）。マルチではホストが進め、ときどき時刻を送って合わせる（ワールドコマンドにはしない） | 共有 |
| `sky.ts` | 時刻と天気に合わせた空・太陽・月・星・雲・光（`Sky`）。見た目だけ | 演出 |
| `weather.ts` | 天気（`Weather`）。晴れ・くもり・雨・嵐をワールドの時刻から固定シードで決める。コマンドメニューで決めた天気だけは `setWeather` コマンドで変え、セーブする | 共有 |
| `rain.ts` | 雨粒・しぶき（`Rain`）。屋根の下に降りこまないよう、上にある物の高さの地図を使う | 自分の画面だけ |
| `wind.ts` | 風（`Wind`）。天気の風の強さで草・木の葉・茂みを揺らすシェーダー（`swayMaterial()` など） | 自分の画面だけ |
| `location.ts` | 場所の一覧（`LocationId` = `'island' \| 'town'`、`LOCATIONS`。海図での位置など） | — |
| `town.ts` | 街の島（`buildTown()`、`townField`）。西側の石造りの港（岸壁・突堤・石段・桟橋）と、広場の農家の屋台と家 | 固定 |
| `house.ts` | 街の家（`buildHouse()`）。石積みの1階、木組みの2階、石板ぶきの屋根。家の中の座標で組み立て、位置と向き（`HouseSpot`）を渡して置く | 固定 |
| `townKit.ts` | 石積みや箱をまとめて1つのメッシュにする道具（`Batch`、`colliderBox()`・`colliderCyl()`、面に沿って置く `Face` の関数） | — |
| `npc.ts` | 住人の体と動き（`Npc`）。見た目は `NpcLook` で住人ごとに変える（`PIER_LOOK`・`FARMER_LOOK`） | 固定 |

## 書くときの決まり

- 配置・形は固定シードの乱数（`mulberry32`）か ID から決め、誰の画面でも同じにする。`Math.random()` は雨・風・しぶきなど自分の画面だけの演出にだけ使う
- 自分の島と街は別々の場面で、どちらも `WORLD_SIZE` 四方・中心が原点。今いない場所の物はレイヤーを変えて隠し（描画にもレイキャストにも映らない）、剛体は `physics.park()` で止める
- 街の岸壁・突堤・石段・屋台・家の当たり判定は、見た目のメッシュでなく見えない箱（`colliderBox()` など）で付ける
- 街のメッシュはなるべく `townKit.ts` の `Batch` でまとめて、描く回数を減らす
- 新しい場所を足すときは `location.ts` の `LocationId` と `LOCATIONS`、地形の `HeightField`、`main.ts` の `goTo()` を合わせて直す
- 共有の状態を持つクラス（`WorldClock`・`Weather`・`BeachPebbles`）は `serialize()` / `restore()` を持ち、`main.ts` の `snapshot()` に入っている。形を変えたら `core/save.ts` の `SAVE_VERSION` を上げる
