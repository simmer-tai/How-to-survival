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
export const SAVE_VERSION = 11;

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
}

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
type WorldDataV10 = Omit<WorldData, 'version' | 'rocks'> & { version: 10 };

/** 10 → 11：岩はすべて無傷として読む */
function fromV10(old: WorldDataV10): WorldData {
  return { ...old, version: 11, rocks: [] };
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
  let data = JSON.parse(json) as WorldData | WorldDataV1 | WorldDataV2 | WorldDataV3 | WorldDataV4 | WorldDataV5 | WorldDataV6 | WorldDataV7 | WorldDataV8 | WorldDataV9 | WorldDataV10;
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
