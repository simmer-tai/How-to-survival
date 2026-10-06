import type { PlayerSave } from '../player/player.js';
import { ITEMS, type InventorySave, type ItemId, type Stack } from '../items/inventory.js';
import { buildPlan, ingredients } from '../items/recipes.js';
import type { VitalsSave } from '../player/vitals.js';
import type { TreeSave } from '../actions/chopping.js';
import { BUSH_HP, type BushSave } from '../actions/foraging.js';
import type { BuildingsSave, PieceSave } from '../actions/build.js';
import type { DropsSave } from '../items/drops.js';
import { WorldClock, type ClockSave } from '../world/clock.js';
import type { PebblesSave } from '../world/pebbles.js';
import type { RockSave } from '../actions/mining.js';
import type { GuideSave } from '../story/guide.js';
import type { RecipeBookSave } from '../items/recipeBook.js';
import type { BoatsSave } from '../actions/boats.js';
import type { SpearsSave } from '../actions/spears.js';
import type { WeatherSave } from '../world/weather.js';
import type { HolesSave } from '../actions/digging.js';
import type { PlantingSave } from '../actions/planting.js';
import type { FireSave } from '../actions/campfire.js';
import type { IslesSave } from '../world/isles.js';

// ワールドはブラウザの localStorage に保存する（ページの URL のオリジンごとに別々になる）。
// 地形や木・茂みの配置は固定シードで毎回同じに生成されるので、変化した状態だけを持つ

// 1 → 2：建てた部材に ID（pid）が付いた
// 2 → 3：床・壁などの部材がアイテムでなくなった（ハンマーで素材から建てる）
// 3 → 4：落とし物が木材以外も持てるようになり、ID（did）が付いた
// 4 → 5：建てた部材が叩かれて減った耐久値（dmg）を持つようになった
// 5 → 6：ワールドの時刻（clock）が入った
// 6 → 7：砂浜の小石の湧き具合（pebbles）が入った
// 7 → 8：茂みが「あと何回採れるか（left）」から「のこりの耐久値（hp）」になった
// 8 → 9：インベントリ・落とし物の道具が、使って減った耐久値（dmg）を持つようになった
// 9 → 10：茂みが、なっている実の数（berries）を持つようになった
// 10 → 11：岩ののこりの耐久値（rocks）が入った
// 11 → 12：桟橋の住人の頼みごとの進み具合（guide）が入った
// 12 → 13：お金（wallet）が入った
// 13 → 14：お金をインベントリのお金のマス（inventory.purse）に入れるようになった（wallet はなくなった）
// 14 → 15：設計図で覚えたレシピ（recipes）が入った
// 15 → 16：水に浮かべた船（boats）が入った
// 16 → 17：プレイヤーが乗っている船の番号（player.boat）が入った
// 17 → 18：投げて刺さった石の槍（spears）が入った
// 18 → 19：場所（島・街）が入った。船（boats.list[].loc）とプレイヤー（player.loc）がどの場所にいるか
// 19 → 20：コマンドメニューで決めた天気（weather）が入った
// 20 → 21：スコップで掘った穴（holes）が入った
// 21 → 22：掘った穴が、掘ってからたった時間（holes.list[].t）を持つようになった
// 22 → 23：焚火の燃料と火（fires）が入った
// 23 → 24：種から育てた木（planted）が入った。穴は木の種を置いたか（holes.list[].s）を持つようになった
// 24 → 25：インベントリ・落とし物の島の地図が、地図の中身（chart）を持つようになった
// 25 → 26：島の地図から海図に載せた島（isles）が入った。プレイヤー・船の場所（loc）に isle0 などが入るようになった
export const SAVE_VERSION = 26;

export interface WorldData {
  version: number;
  player: PlayerSave;
  inventory: InventorySave;
  vitals: VitalsSave;
  /** props の木の生成順 */
  trees: TreeSave[];
  /** props の茂みの生成順 */
  bushes: BushSave[];
  /** 地面に落ちている物 */
  drops: DropsSave;
  /** 建てた部材 */
  built: BuildingsSave;
  /** ワールドの時刻 */
  clock: ClockSave;
  /** 砂浜の小石の湧き具合 */
  pebbles: PebblesSave;
  /** props の岩の生成順 */
  rocks: RockSave[];
  /** 桟橋の住人の頼みごとの進み具合（自分だけの状態） */
  guide: GuideSave;
  /** 設計図で覚えたレシピ（自分だけの状態） */
  recipes: RecipeBookSave;
  /** 水に浮かべた船 */
  boats: BoatsSave;
  /** 投げて刺さった石の槍 */
  spears: SpearsSave;
  /** コマンドメニューで決めた天気（ふだんの天気のままなら null） */
  weather: WeatherSave | null;
  /** スコップで掘った穴 */
  holes: HolesSave;
  /** 置いた焚火の燃料の欄と、燃えている燃料（焚火の部材そのものは built に入る） */
  fires: FireSave[];
  /** 種から育てた木（育つ途中の苗も） */
  planted: PlantingSave;
  /** 島の地図から海図に載せた島（島の番号順） */
  isles: IslesSave;
}

/** 自分だけの状態（マルチでは各自のブラウザに残す） */
export const PERSONAL_KEYS = ['player', 'inventory', 'vitals', 'guide', 'recipes'] as const;
export type PersonalData = Pick<WorldData, (typeof PERSONAL_KEYS)[number]>;
/** 共有ワールドの状態（マルチでは、途中参加した人にホストがまるごと送る） */
export type SharedWorld = Omit<WorldData, 'version' | (typeof PERSONAL_KEYS)[number]>;

/** バージョン 1 のセーブデータ（部材に ID がない） */
type WorldDataV1 = Omit<WorldDataV3, 'version' | 'built'> & { version: 1; built: Omit<PieceSave, 'pid'>[] };

/** バージョン 2 のセーブデータ（インベントリに部材のアイテムが入っていることがある） */
type WorldDataV2 = Omit<WorldDataV3, 'version' | 'inventory'> & {
  version: 2;
  inventory: { slots: ({ item: string; count: number } | null)[]; selected: number };
};

/** 1 → 2：部材に並び順で ID を付ける */
function fromV1(old: WorldDataV1): WorldDataV2 {
  const pieces = old.built.map((b, i) => ({ ...b, pid: i }));
  return { ...old, version: 2, built: { next: pieces.length, pieces } };
}

/** バージョン 3 のセーブデータ（落とし物は木材の位置・向きの並びだけ） */
type WorldDataV3 = Omit<WorldDataV5, 'version' | 'drops'> & { version: 3; drops: number[][] };

/** 2 → 3：インベントリにある部材のアイテムを、ハンマーで建てるときの素材に戻す（入りきらない分は捨てる） */
function fromV2(old: WorldDataV2): WorldDataV3 {
  const slots = old.inventory.slots.map((s) => (s ? { ...s } : null));
  const refund = new Map<ItemId, number>();
  slots.forEach((s, i) => {
    const plan = s && buildPlan(s.item);
    if (!s || !plan) return;
    for (const [item, n] of ingredients(plan)) refund.set(item, (refund.get(item) ?? 0) + n * s.count);
    slots[i] = null;
  });
  for (let [item, count] of refund) {
    const max = ITEMS[item].maxStack;
    for (const s of slots) {
      if (s?.item !== item || s.count >= max) continue;
      const n = Math.min(max - s.count, count);
      s.count += n;
      count -= n;
    }
    for (let i = 0; i < slots.length && count > 0; i++) {
      if (slots[i]) continue;
      slots[i] = { item, count: Math.min(max, count) };
      count -= slots[i]!.count;
    }
  }
  return { ...old, version: 3, inventory: { ...old.inventory, slots: slots as (Stack | null)[] } };
}

/** 3 → 4：落ちている木材に並び順で ID を付ける */
function fromV3(old: WorldDataV3): WorldDataV4 {
  const list = old.drops.map((p, did) => ({ did, item: 'wood' as const, count: 1, p }));
  return { ...old, version: 4, drops: { next: list.length, list } };
}

/** バージョン 4 のセーブデータ（部材に dmg がない） */
type WorldDataV4 = Omit<WorldDataV5, 'version'> & { version: 4 };

/** 4 → 5：dmg がない部材は無傷として読めるので、形はそのまま */
function fromV4(old: WorldDataV4): WorldDataV5 {
  return { ...old, version: 5 };
}

/** バージョン 5 のセーブデータ（時刻がない） */
type WorldDataV5 = Omit<WorldDataV6, 'version' | 'clock'> & { version: 5 };

/** 5 → 6：時刻がないワールドは 1日目の朝から始める */
function fromV5(old: WorldDataV5): WorldDataV6 {
  return { ...old, version: 6, clock: new WorldClock().serialize() };
}

/** バージョン 6 のセーブデータ（小石がない） */
type WorldDataV6 = Omit<WorldDataV7, 'version' | 'pebbles'> & { version: 6 };

/** 6 → 7：まだ小石を置いていないワールドとして読む（読み込んだときに砂浜へ置く） */
function fromV6(old: WorldDataV6): WorldDataV7 {
  return { ...old, version: 7, pebbles: { seq: 0, time: 0 } };
}

/** バージョン 7 のセーブデータ（茂みは あと何回採れるか を持つ） */
type WorldDataV7 = Omit<WorldDataV8, 'version' | 'bushes'> & { version: 7; bushes: { left: number; time: number }[] };

/** 7 → 8：まだ残っている茂みは無傷に、採り尽くした茂みは生え直し待ちのまま読む */
function fromV7(old: WorldDataV7): WorldDataV8 {
  const bushes = old.bushes.map((b) => ({ hp: b.left > 0 ? BUSH_HP : 0, time: b.time }));
  return { ...old, version: 8, bushes };
}

/** バージョン 8 のセーブデータ（道具に dmg がない） */
type WorldDataV8 = Omit<WorldDataV9, 'version'> & { version: 8 };

/** 8 → 9：dmg がない道具は新品として読めるので、形はそのまま */
function fromV8(old: WorldDataV8): WorldDataV9 {
  return { ...old, version: 9 };
}

/** バージョン 9 のセーブデータ（茂みに berries がない） */
type WorldDataV9 = Omit<WorldDataV10, 'version'> & { version: 9 };

/** 9 → 10：berries がない茂みは実が全部なっているとして読めるので、形はそのまま */
function fromV9(old: WorldDataV9): WorldDataV10 {
  return { ...old, version: 10 };
}

/** バージョン 10 のセーブデータ（岩がない） */
type WorldDataV10 = Omit<WorldDataV11, 'version' | 'rocks'> & { version: 10 };

/** 10 → 11：岩はすべて無傷として読む */
function fromV10(old: WorldDataV10): WorldDataV11 {
  return { ...old, version: 11, rocks: [] };
}

/** バージョン 11 のセーブデータ（頼みごとの進み具合がない） */
type WorldDataV11 = Omit<WorldDataV12, 'version' | 'guide'> & { version: 11 };

/** 11 → 12：頼みごとは最初から。持ち物で達成済みの目標は、読み込んだあとにすぐ進む */
function fromV11(old: WorldDataV11): WorldDataV12 {
  return { ...old, version: 12, guide: { step: 0 } };
}

/** バージョン 12 のセーブデータ（お金がない。試作の「貝貨」がインベントリに入っていることがある） */
type WorldDataV12 = Omit<WorldDataV13, 'version' | 'wallet'> & { version: 12 };

/** 12 → 13：お金は 0 枚から。インベントリに残っている貝貨は、同じ枚数のコインに換える */
function fromV12(old: WorldDataV12): WorldDataV13 {
  let coins = 0;
  const slots = old.inventory.slots.map((s) => {
    if ((s?.item as string) !== 'shell') return s;
    coins += s!.count;
    return null;
  });
  return { ...old, version: 13, inventory: { ...old.inventory, slots }, wallet: { coins } };
}

/** バージョン 13 のセーブデータ（お金はインベントリの外の wallet に入っている） */
type WorldDataV13 = Omit<WorldDataV14, 'version'> & { version: 13; wallet: { coins: number } };

/** 13 → 14：wallet のお金を、インベントリのお金のマスのコインにする */
function fromV13({ wallet, ...old }: WorldDataV13): WorldDataV14 {
  const coins = Math.min(wallet.coins, ITEMS.coin.maxStack);
  return { ...old, version: 14, inventory: { ...old.inventory, purse: coins > 0 ? { item: 'coin', count: coins } : null } };
}

/** バージョン 14 のセーブデータ（覚えたレシピがない） */
type WorldDataV14 = Omit<WorldDataV15, 'version' | 'recipes'> & { version: 14 };

/** 14 → 15：まだ何も覚えていないとして読む */
function fromV14(old: WorldDataV14): WorldDataV15 {
  return { ...old, version: 15, recipes: [] };
}

/** バージョン 15 のセーブデータ（船がない） */
type WorldDataV15 = Omit<WorldDataV16, 'version' | 'boats'> & { version: 15 };

/** 15 → 16：船はまだ1つも浮かべていないとして読む */
function fromV15(old: WorldDataV15): WorldDataV16 {
  return { ...old, version: 16, boats: { next: 0, list: [] } };
}

/** バージョン 16 のセーブデータ（player.boat がない） */
type WorldDataV16 = Omit<WorldDataV17, 'version'> & { version: 16 };

/** 16 → 17：boat がないプレイヤーは船に乗っていないとして読めるので、形はそのまま */
function fromV16(old: WorldDataV16): WorldDataV17 {
  return { ...old, version: 17 };
}

/** バージョン 17 のセーブデータ（刺さった槍がない） */
type WorldDataV17 = Omit<WorldDataV18, 'version' | 'spears'> & { version: 17 };

/** 17 → 18：刺さった槍はまだない */
function fromV17(old: WorldDataV17): WorldDataV18 {
  return { ...old, version: 18, spears: { next: 0, list: [] } };
}

/** バージョン 18 のセーブデータ（場所がない） */
type WorldDataV18 = Omit<WorldDataV19, 'version'> & { version: 18 };

/** 18 → 19：loc がない船とプレイヤーは自分の島にいるとして読めるので、形はそのまま */
function fromV18(old: WorldDataV18): WorldDataV19 {
  return { ...old, version: 19 };
}

/** バージョン 19 のセーブデータ（天気の指定がない） */
type WorldDataV19 = Omit<WorldDataV20, 'version' | 'weather'> & { version: 19 };

/** 19 → 20：天気は時刻から決まる、ふだんの天気のまま */
function fromV19(old: WorldDataV19): WorldDataV20 {
  return { ...old, version: 20, weather: null };
}

/** バージョン 20 のセーブデータ（穴がない） */
type WorldDataV20 = Omit<WorldDataV21, 'version' | 'holes'> & { version: 20 };

/** 20 → 21：穴はまだ1つも掘っていない */
function fromV20(old: WorldDataV20): WorldDataV21 {
  return { ...old, version: 21, holes: { next: 0, list: [] } };
}

/** バージョン 21 のセーブデータ（穴に t がない） */
type WorldDataV21 = Omit<WorldDataV22, 'version'> & { version: 21 };

/** 21 → 22：t がない穴は掘ったばかりとして読めるので、形はそのまま */
function fromV21(old: WorldDataV21): WorldDataV22 {
  return { ...old, version: 22 };
}

/** バージョン 22 のセーブデータ（焚火がない） */
type WorldDataV22 = Omit<WorldDataV23, 'version' | 'fires'> & { version: 22 };

/** 22 → 23：焚火はまだ1つも置いていない */
function fromV22(old: WorldDataV22): WorldDataV23 {
  return { ...old, version: 23, fires: [] };
}

/** バージョン 23 のセーブデータ（植えた木がない） */
type WorldDataV23 = Omit<WorldDataV24, 'version' | 'planted'> & { version: 23 };

/** 23 → 24：木はまだ1本も植えていない（s がない穴は種を置いていないとして読める） */
function fromV23(old: WorldDataV23): WorldDataV24 {
  return { ...old, version: 24, planted: { list: [] } };
}

/** バージョン 24 のセーブデータ（島の地図がない） */
type WorldDataV24 = Omit<WorldDataV25, 'version'> & { version: 24 };

/** 24 → 25：島の地図はまだ1枚もないので、形はそのまま */
function fromV24(old: WorldDataV24): WorldDataV25 {
  return { ...old, version: 25 };
}

/** バージョン 25 のセーブデータ（海図に載せた島がない） */
type WorldDataV25 = Omit<WorldData, 'version' | 'isles'> & { version: 25 };

/** 25 → 26：海図に載せた島はまだない */
function fromV25(old: WorldDataV25): WorldData {
  return { ...old, version: 26, isles: { list: [] } };
}

export interface WorldMeta {
  id: string;
  name: string;
  createdAt: number;
  savedAt: number;
}

const INDEX_KEY = 'warfarming:worlds';
const dataKey = (id: string) => `warfarming:world:${id}`;

/** 最後に遊んだ順 */
export function listWorlds(): WorldMeta[] {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as WorldMeta[];
    return list.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function writeIndex(list: WorldMeta[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export function createWorld(name: string): WorldMeta {
  const now = Date.now();
  const meta = { id: now.toString(36) + Math.random().toString(36).slice(2, 8), name, createdAt: now, savedAt: now };
  writeIndex([...listWorlds(), meta]);
  return meta;
}

/** まだ一度もセーブしていなければ null。データが壊れていたら例外を投げる */
export function loadWorld(id: string): WorldData | null {
  const json = localStorage.getItem(dataKey(id));
  if (json === null) return null;
  let data = JSON.parse(json) as WorldData | WorldDataV1 | WorldDataV2 | WorldDataV3 | WorldDataV4 | WorldDataV5 | WorldDataV6 | WorldDataV7 | WorldDataV8 | WorldDataV9 | WorldDataV10 | WorldDataV11 | WorldDataV12 | WorldDataV13 | WorldDataV14 | WorldDataV15 | WorldDataV16 | WorldDataV17 | WorldDataV18 | WorldDataV19 | WorldDataV20 | WorldDataV21 | WorldDataV22 | WorldDataV23 | WorldDataV24 | WorldDataV25;
  if (data.version === 1) data = fromV1(data as WorldDataV1);
  if (data.version === 2) data = fromV2(data as WorldDataV2);
  if (data.version === 3) data = fromV3(data as WorldDataV3);
  if (data.version === 4) data = fromV4(data as WorldDataV4);
  if (data.version === 5) data = fromV5(data as WorldDataV5);
  if (data.version === 6) data = fromV6(data as WorldDataV6);
  if (data.version === 7) data = fromV7(data as WorldDataV7);
  if (data.version === 8) data = fromV8(data as WorldDataV8);
  if (data.version === 9) data = fromV9(data as WorldDataV9);
  if (data.version === 10) data = fromV10(data as WorldDataV10);
  if (data.version === 11) data = fromV11(data as WorldDataV11);
  if (data.version === 12) data = fromV12(data as WorldDataV12);
  if (data.version === 13) data = fromV13(data as WorldDataV13);
  if (data.version === 14) data = fromV14(data as WorldDataV14);
  if (data.version === 15) data = fromV15(data as WorldDataV15);
  if (data.version === 16) data = fromV16(data as WorldDataV16);
  if (data.version === 17) data = fromV17(data as WorldDataV17);
  if (data.version === 18) data = fromV18(data as WorldDataV18);
  if (data.version === 19) data = fromV19(data as WorldDataV19);
  if (data.version === 20) data = fromV20(data as WorldDataV20);
  if (data.version === 21) data = fromV21(data as WorldDataV21);
  if (data.version === 22) data = fromV22(data as WorldDataV22);
  if (data.version === 23) data = fromV23(data as WorldDataV23);
  if (data.version === 24) data = fromV24(data as WorldDataV24);
  if (data.version === 25) data = fromV25(data as WorldDataV25);
  if (data.version !== SAVE_VERSION) throw new Error(`unknown save version: ${data.version}`);
  return data as WorldData;
}

/** 保存できたら true（容量オーバーなどで失敗したら false） */
export function saveWorld(id: string, data: WorldData): boolean {
  try {
    localStorage.setItem(dataKey(id), JSON.stringify(data));
    writeIndex(listWorlds().map((w) => (w.id === id ? { ...w, savedAt: Date.now() } : w)));
    return true;
  } catch (e) {
    console.error('セーブに失敗しました', e);
    return false;
  }
}

export function deleteWorld(id: string): void {
  localStorage.removeItem(dataKey(id));
  writeIndex(listWorlds().filter((w) => w.id !== id));
}

// ---- マルチの参加者：ほかの人のワールドで遊んだときの、自分だけの状態（位置・持ち物など） ----
// 共有ワールドはホストのブラウザにセーブされるので、参加者は自分だけの状態だけを、ホストのワールドの id ごとに残す

const guestKey = (worldId: string) => `warfarming:guest:${worldId}`;

/** 参加者としてのセーブ（SAVE_VERSION が違う古いものは読まず、はじめからにする） */
interface GuestSave extends PersonalData { version: number }

/** そのワールドに参加したときの自分だけの状態（初めてなら、読めなければ null） */
export function loadGuest(worldId: string): PersonalData | null {
  try {
    const data = JSON.parse(localStorage.getItem(guestKey(worldId)) ?? 'null') as GuestSave | null;
    return data?.version === SAVE_VERSION ? data : null;
  } catch {
    return null;
  }
}

/** 保存できたら true */
export function saveGuest(worldId: string, data: PersonalData): boolean {
  try {
    localStorage.setItem(guestKey(worldId), JSON.stringify({ version: SAVE_VERSION, ...data } satisfies GuestSave));
    return true;
  } catch (e) {
    console.error('セーブに失敗しました', e);
    return false;
  }
}
