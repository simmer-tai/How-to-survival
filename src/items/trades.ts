import type { ItemId } from './inventory.js';

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
    { give: { berry: 3 }, get: { item: 'coin', count: 1 } }, // ベリー3つでコイン1枚
    { give: { fish: 1 }, get: { item: 'coin', count: 2 } }, // 魚は珍しいものほど高く買い取る
    { give: { clownfish: 1 }, get: { item: 'coin', count: 4 } },
    { give: { snapper: 1 }, get: { item: 'coin', count: 6 } },
    { give: { puffer: 1 }, get: { item: 'coin', count: 5 } },
    { give: { flounder: 1 }, get: { item: 'coin', count: 6 } },
    { give: { bonito: 1 }, get: { item: 'coin', count: 10 } },
    { give: { coin: 20 }, get: { item: 'boatBlueprint', count: 1 } }, // コイン20枚で木製の船の設計図
  ],
  // 農家は島で採れる物を桟橋の人より高く買い取る（街まで運ぶ手間のぶん）
  farmer: [
    { give: { berry: 2 }, get: { item: 'coin', count: 1 } }, // ベリー2つでコイン1枚
    { give: { leaf: 8 }, get: { item: 'coin', count: 1 } }, // 葉っぱは畑の肥やしにする
    { give: { vine: 4 }, get: { item: 'coin', count: 1 } }, // ツルは作物を支柱に縛るのに使う
    { give: { coin: 2 }, get: { item: 'seed', count: 3 } }, // コイン2枚で木の種3つ
  ],
  // 地図売りは地図だけを売る（買い取りはしない）
  mapmaker: [
    { give: { coin: 8 }, get: { item: 'map', count: 1 } }, // コイン8枚で地図
  ],
};
