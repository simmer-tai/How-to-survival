import type { ItemId, Stack } from './inventory.js';
import type { PieceId } from '../actions/pieces.js';

// クラフトのレシピ。台の上にドラッグして置いた素材から、作れる物の候補を出す（並べ方は問わない）。
// クラフトはインベントリ（自分だけの状態）の中で完結するので、ワールドコマンドにはしない

/**
 * クラフトする場所。null は手元（インベントリを開いたときの小さな台）、workbench は作業台、draftingTable は製図台。
 * 製図台では、ここのレシピのほかに、白紙の地図とメモから島の地図を作れる（actions/crafting.ts・items/islandChart.ts）
 */
export type Station = 'workbench' | 'draftingTable' | null;

export interface Recipe {
  result: ItemId;
  count: number;
  /** 1回作るのに使う素材と個数 */
  cost: Partial<Record<ItemId, number>>;
  station: Station;
  /** 設計図で作り方を覚えるまで作れない（覚えたかどうかは items/recipeBook.ts） */
  locked?: boolean;
}

export const RECIPES: Recipe[] = [
  { result: 'workbench', count: 1, cost: { wood: 2, stick: 2 }, station: null },
  { result: 'campfire', count: 1, cost: { stone: 5, stick: 3 }, station: null }, // 石を輪に並べ、真ん中に枝を組む
  { result: 'plank', count: 2, cost: { wood: 1 }, station: 'workbench' },
  { result: 'stoneKnife', count: 1, cost: { stone: 2 }, station: null }, // 石を石で打ち欠いて刃にする
  { result: 'spear', count: 1, cost: { stick: 1, vine: 2, stoneKnife: 1 }, station: null, locked: true }, // 石のナイフを枝の先にツルで縛りつける
  { result: 'axe', count: 1, cost: { stone: 2, vine: 2, stick: 1 }, station: null }, // 石の刃を枝にツルで縛りつける
  { result: 'pickaxe', count: 1, cost: { stone: 3, stick: 1, vine: 2 }, station: 'workbench', locked: true }, // とがらせた石を枝にツルで縛りつける
  { result: 'shovel', count: 1, cost: { plank: 1, stick: 1, vine: 2 }, station: 'workbench' }, // 板の刃を枝にツルで縛りつける
  { result: 'fishingRod', count: 1, cost: { stick: 2, vine: 3 }, station: null, locked: true }, // 枝2本をツルでつなぎ、ツルを糸にして垂らす
  { result: 'hammer', count: 1, cost: { wood: 1, stick: 2 }, station: 'workbench', locked: true },
  { result: 'boat', count: 1, cost: { plank: 12, stick: 4, vine: 4 }, station: 'workbench', locked: true }, // 板を枝の骨組みに張り、ツルで縛る
  { result: 'draftingTable', count: 1, cost: { plank: 6, stick: 4 }, station: 'workbench', locked: true }, // 板の天板と脚を組む（設計図は街の地図屋で買う）
];

/** ハンマーで建てる部材と、1つ建てるのに使う素材。壊すと同じだけ素材が戻る（作業台・製図台・焚火はアイテムとして置くのでここにはない） */
export interface BuildPlan {
  piece: Exclude<PieceId, 'workbench' | 'draftingTable' | 'campfire'>;
  name: string;
  cost: Partial<Record<ItemId, number>>;
}

export const BUILD_PLANS: BuildPlan[] = [
  // 木の部材は板材を枝で組む（板材は木材1つから2枚作れる）
  { piece: 'floor', name: '木の床', cost: { plank: 6, stick: 2 } },
  { piece: 'wall', name: '木の壁', cost: { plank: 8, stick: 2 } },
  { piece: 'doorway', name: '入口の壁', cost: { plank: 6, stick: 2 } },
  { piece: 'fence', name: '木の柵', cost: { plank: 2, stick: 2 } },
  { piece: 'stairs', name: '木の階段', cost: { plank: 8, stick: 2 } },
  { piece: 'foundation', name: '石の土台', cost: { stone: 4 } },
];

/** 部材の id から、ハンマーで建てるときの素材を引く（作業台など、ハンマーで建てない物なら undefined） */
export function buildPlan(id: string): BuildPlan | undefined {
  return BUILD_PLANS.find((b) => b.piece === id);
}

/** その場所で作れるレシピ（作業台では手元のレシピも作れる） */
export function recipesAt(station: Station): Recipe[] {
  return RECIPES.filter((r) => r.station === null || r.station === station);
}

export function ingredients(recipe: { cost: Partial<Record<ItemId, number>> }): [ItemId, number][] {
  return Object.entries(recipe.cost) as [ItemId, number][];
}

/** 置いてある素材の、アイテムごとの合計 */
export function totals(stacks: (Stack | null)[]): Map<ItemId, number> {
  const sum = new Map<ItemId, number>();
  for (const s of stacks) if (s) sum.set(s.item, (sum.get(s.item) ?? 0) + s.count);
  return sum;
}

/** 素材で何回作れるか */
export function timesCraftable(recipe: Recipe, have: Map<ItemId, number>): number {
  return Math.min(...ingredients(recipe).map(([item, n]) => Math.floor((have.get(item) ?? 0) / n)));
}

/**
 * 置いた素材から出す候補。作れる物を先に、置いた素材を使うがまだ足りない物をあとに並べる。
 * 置いた素材と関係ないレシピと、まだ作り方を覚えていないレシピ（knows が false）は出さない
 */
export function candidates(station: Station, have: Map<ItemId, number>, knows: (recipe: Recipe) => boolean = () => true): { recipe: Recipe; times: number }[] {
  return recipesAt(station)
    .filter((r) => ingredients(r).some(([item]) => have.has(item)) && knows(r))
    .map((recipe) => ({ recipe, times: timesCraftable(recipe, have) }))
    .sort((a, b) => Number(b.times > 0) - Number(a.times > 0));
}
