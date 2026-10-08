import type { ItemId } from './inventory.js';

const LAND_INFO_PRICE = 3; // 地形のメモ1枚の値段（コイン）

// 住人との取引。持ち物を渡して、代わりの物を受け取る（コインもアイテムなので、売るのも買うのも同じ形で書く）。
// 住人は在庫を持たず、変わるのは自分のインベントリだけなので、自分だけの行動としてその場で処理する（ワールドコマンドにはしない）

export interface Trade {
  /** 1回の取引で渡す物と個数 */
  give: Partial<Record<ItemId, number>>;
  /** 1回の取引で受け取る物と個数 */
  get: { item: ItemId; count: number };
}

/** 取引できる住人（pier：自分の島の桟橋の人、farmer：街の広場の農家、mapmaker：街の地図屋の地図売り） */
export type MerchantId = 'pier' | 'farmer' | 'mapmaker';

/** 住人ごとの取引の一覧（上から順に画面に並ぶ。買い取りを先に、売り物をあとに書く） */
export const TRADES: Record<MerchantId, Trade[]> = {
  pier: [
    { give: { berry: 5 }, get: { item: 'coin', count: 1 } }, // ベリー5つでコイン1枚
    { give: { fish: 1 }, get: { item: 'coin', count: 2 } }, // 魚は珍しいものほど高く買い取る
    { give: { clownfish: 1 }, get: { item: 'coin', count: 4 } },
    { give: { snapper: 1 }, get: { item: 'coin', count: 6 } },
    { give: { puffer: 1 }, get: { item: 'coin', count: 5 } },
    { give: { flounder: 1 }, get: { item: 'coin', count: 6 } },
    { give: { bonito: 1 }, get: { item: 'coin', count: 10 } },
    // 設計図は船だけ（ハンマー・ツルハシ・槍・釣り竿は最初から作れる）
    { give: { coin: 20 }, get: { item: 'boatBlueprint', count: 1 } }, // コイン20枚で木製の船の設計図
  ],
  // 農家はベリーを桟橋の人と同じ値段で買い取り、木の種とくわの設計図を売る
  farmer: [
    { give: { berry: 5 }, get: { item: 'coin', count: 1 } }, // ベリー5つでコイン1枚
    { give: { coin: 2 }, get: { item: 'seed', count: 3 } }, // コイン2枚で木の種3つ
    { give: { coin: 6 }, get: { item: 'hoeBlueprint', count: 1 } }, // くわの設計図
  ],
  // 地図売りは白紙の地図・製図台の設計図・「木々の海」のメモを売る（買い取りはしない）。
  // ほかの地形のメモは遊びへの影響が小さいので売らない（アイテムとしては残すので、持っている分は使える）
  mapmaker: [
    { give: { coin: 8 }, get: { item: 'map', count: 1 } }, // コイン8枚で白紙の地図
    { give: { coin: 12 }, get: { item: 'draftingTableBlueprint', count: 1 } }, // 製図台の設計図（製図台で白紙の地図とメモから島の地図を作る）
    { give: { coin: LAND_INFO_PRICE }, get: { item: 'forestInfo', count: 1 } }, // 「木々の海」のメモ
  ],
};
