/** 住人ごとの取引の一覧（上から順に画面に並ぶ。買い取りを先に、売り物をあとに書く） */
export const TRADES = {
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
