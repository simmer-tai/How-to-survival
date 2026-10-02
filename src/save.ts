import type { PlayerSave } from './player.js';
import type { InventorySave } from './inventory.js';
import type { VitalsSave } from './vitals.js';
import type { TreeSave } from './chopping.js';
import type { BushSave } from './foraging.js';
import type { BuiltSave } from './build.js';

// ワールドはブラウザの localStorage に保存する（ページの URL のオリジンごとに別々になる）。
// 地形や木・茂みの配置は固定シードで毎回同じに生成されるので、変化した状態だけを持つ

export const SAVE_VERSION = 1;

export interface WorldData {
  version: number;
  player: PlayerSave;
  inventory: InventorySave;
  vitals: VitalsSave;
  /** props の木の生成順 */
  trees: TreeSave[];
  /** props の茂みの生成順 */
  bushes: BushSave[];
  /** 地面に落ちている木材 */
  drops: number[][];
  built: BuiltSave[];
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
  const data = JSON.parse(json) as WorldData;
  if (data.version !== SAVE_VERSION) throw new Error(`unknown save version: ${data.version}`);
  return data;
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
