export const RECIPES = [
    { result: 'workbench', count: 1, cost: { wood: 2, stick: 2 }, station: null },
    { result: 'campfire', count: 1, cost: { stone: 5, stick: 3 }, station: null }, // 石を輪に並べ、真ん中に枝を組む
    { result: 'plank', count: 2, cost: { wood: 1 }, station: 'workbench' },
    { result: 'torch', count: 1, cost: { stick: 1, leaf: 2, vine: 1 }, station: null }, // 枝の先に葉っぱを巻きつけ、ツルで縛る
    { result: 'stoneKnife', count: 1, cost: { stone: 2 }, station: null }, // 石を石で打ち欠いて刃にする
    { result: 'spear', count: 1, cost: { stick: 1, vine: 2, stoneKnife: 1 }, station: null, locked: true }, // 石のナイフを枝の先にツルで縛りつける
    { result: 'axe', count: 1, cost: { stone: 2, vine: 2, stick: 1 }, station: null }, // 石の刃を枝にツルで縛りつける
    { result: 'pickaxe', count: 1, cost: { stone: 3, stick: 1, vine: 2 }, station: 'workbench', locked: true }, // とがらせた石を枝にツルで縛りつける
    { result: 'shovel', count: 1, cost: { plank: 1, stick: 1, vine: 2 }, station: 'workbench' }, // 板の刃を枝にツルで縛りつける
    { result: 'fishingRod', count: 1, cost: { stick: 2, vine: 3 }, station: null, locked: true }, // 枝2本をツルでつなぎ、ツルを糸にして垂らす
    { result: 'hammer', count: 1, cost: { wood: 1, stick: 2 }, station: 'workbench', locked: true },
    { result: 'boat', count: 1, cost: { plank: 12, stick: 4, vine: 4 }, station: 'workbench', locked: true }, // 板を枝の骨組みに張り、ツルで縛る
    { result: 'hoe', count: 1, cost: { wood: 1, stick: 1, vine: 2 }, station: 'workbench', locked: true }, // 木材を平たく削った刃を枝にツルで縛りつける（設計図は街の農家で買う）
    { result: 'draftingTable', count: 1, cost: { plank: 6, stick: 4 }, station: 'workbench', locked: true }, // 板の天板と脚を組む（設計図は街の地図屋で買う）
];
export const BUILD_PLANS = [
    // 木の部材は板材を枝で組む（板材は木材1つから2枚作れる）
    { piece: 'floor', name: '木の床', cost: { plank: 6, stick: 2 } },
    { piece: 'wall', name: '木の壁', cost: { plank: 8, stick: 2 } },
    { piece: 'doorway', name: '入口の壁', cost: { plank: 6, stick: 2 } },
    { piece: 'fence', name: '木の柵', cost: { plank: 2, stick: 2 } },
    { piece: 'pillar', name: '木の柱', cost: { plank: 3, vine: 1 } },
    { piece: 'stairs', name: '木の階段', cost: { plank: 8, stick: 2 } },
    { piece: 'foundation', name: '石の土台', cost: { stone: 4 } },
];
/** 部材の id から、ハンマーで建てるときの素材を引く（作業台など、ハンマーで建てない物なら undefined） */
export function buildPlan(id) {
    return BUILD_PLANS.find((b) => b.piece === id);
}
/** その場所で作れるレシピ（作業台では手元のレシピも作れる。製図台では島の地図しか作れないので、決まったレシピは出さない） */
export function recipesAt(station) {
    if (station === 'draftingTable')
        return [];
    return RECIPES.filter((r) => r.station === null || r.station === station);
}
export function ingredients(recipe) {
    return Object.entries(recipe.cost);
}
/** 置いてある素材の、アイテムごとの合計 */
export function totals(stacks) {
    const sum = new Map();
    for (const s of stacks)
        if (s)
            sum.set(s.item, (sum.get(s.item) ?? 0) + s.count);
    return sum;
}
/** 素材で何回作れるか */
export function timesCraftable(recipe, have) {
    return Math.min(...ingredients(recipe).map(([item, n]) => Math.floor((have.get(item) ?? 0) / n)));
}
/**
 * 置いた素材から出す候補。作れる物を先に、置いた素材を使うがまだ足りない物をあとに並べる。
 * 置いた素材と関係ないレシピと、まだ作り方を覚えていないレシピ（knows が false）は出さない
 */
export function candidates(station, have, knows = () => true) {
    return recipesAt(station)
        .filter((r) => ingredients(r).some(([item]) => have.has(item)) && knows(r))
        .map((recipe) => ({ recipe, times: timesCraftable(recipe, have) }))
        .sort((a, b) => Number(b.times > 0) - Number(a.times > 0));
}
