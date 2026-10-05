import { ITEMS } from '../items/inventory.js';
import { buildPlan, ingredients } from '../items/recipes.js';
import { BUSH_HP } from '../actions/foraging.js';
import { WorldClock } from '../world/clock.js';
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
/** 1 → 2：部材に並び順で ID を付ける */
function fromV1(old) {
    const pieces = old.built.map((b, i) => ({ ...b, pid: i }));
    return { ...old, version: 2, built: { next: pieces.length, pieces } };
}
/** 2 → 3：インベントリにある部材のアイテムを、ハンマーで建てるときの素材に戻す（入りきらない分は捨てる） */
function fromV2(old) {
    const slots = old.inventory.slots.map((s) => (s ? { ...s } : null));
    const refund = new Map();
    slots.forEach((s, i) => {
        const plan = s && buildPlan(s.item);
        if (!s || !plan)
            return;
        for (const [item, n] of ingredients(plan))
            refund.set(item, (refund.get(item) ?? 0) + n * s.count);
        slots[i] = null;
    });
    for (let [item, count] of refund) {
        const max = ITEMS[item].maxStack;
        for (const s of slots) {
            if (s?.item !== item || s.count >= max)
                continue;
            const n = Math.min(max - s.count, count);
            s.count += n;
            count -= n;
        }
        for (let i = 0; i < slots.length && count > 0; i++) {
            if (slots[i])
                continue;
            slots[i] = { item, count: Math.min(max, count) };
            count -= slots[i].count;
        }
    }
    return { ...old, version: 3, inventory: { ...old.inventory, slots: slots } };
}
/** 3 → 4：落ちている木材に並び順で ID を付ける */
function fromV3(old) {
    const list = old.drops.map((p, did) => ({ did, item: 'wood', count: 1, p }));
    return { ...old, version: 4, drops: { next: list.length, list } };
}
/** 4 → 5：dmg がない部材は無傷として読めるので、形はそのまま */
function fromV4(old) {
    return { ...old, version: 5 };
}
/** 5 → 6：時刻がないワールドは 1日目の朝から始める */
function fromV5(old) {
    return { ...old, version: 6, clock: new WorldClock().serialize() };
}
/** 6 → 7：まだ小石を置いていないワールドとして読む（読み込んだときに砂浜へ置く） */
function fromV6(old) {
    return { ...old, version: 7, pebbles: { seq: 0, time: 0 } };
}
/** 7 → 8：まだ残っている茂みは無傷に、採り尽くした茂みは生え直し待ちのまま読む */
function fromV7(old) {
    const bushes = old.bushes.map((b) => ({ hp: b.left > 0 ? BUSH_HP : 0, time: b.time }));
    return { ...old, version: 8, bushes };
}
/** 8 → 9：dmg がない道具は新品として読めるので、形はそのまま */
function fromV8(old) {
    return { ...old, version: 9 };
}
/** 9 → 10：berries がない茂みは実が全部なっているとして読めるので、形はそのまま */
function fromV9(old) {
    return { ...old, version: 10 };
}
/** 10 → 11：岩はすべて無傷として読む */
function fromV10(old) {
    return { ...old, version: 11, rocks: [] };
}
const INDEX_KEY = 'warfarming:worlds';
const dataKey = (id) => `warfarming:world:${id}`;
/** 最後に遊んだ順 */
export function listWorlds() {
    try {
        const list = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
        return list.sort((a, b) => b.savedAt - a.savedAt);
    }
    catch {
        return [];
    }
}
function writeIndex(list) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}
export function createWorld(name) {
    const now = Date.now();
    const meta = { id: now.toString(36) + Math.random().toString(36).slice(2, 8), name, createdAt: now, savedAt: now };
    writeIndex([...listWorlds(), meta]);
    return meta;
}
/** まだ一度もセーブしていなければ null。データが壊れていたら例外を投げる */
export function loadWorld(id) {
    const json = localStorage.getItem(dataKey(id));
    if (json === null)
        return null;
    let data = JSON.parse(json);
    if (data.version === 1)
        data = fromV1(data);
    if (data.version === 2)
        data = fromV2(data);
    if (data.version === 3)
        data = fromV3(data);
    if (data.version === 4)
        data = fromV4(data);
    if (data.version === 5)
        data = fromV5(data);
    if (data.version === 6)
        data = fromV6(data);
    if (data.version === 7)
        data = fromV7(data);
    if (data.version === 8)
        data = fromV8(data);
    if (data.version === 9)
        data = fromV9(data);
    if (data.version === 10)
        data = fromV10(data);
    if (data.version !== SAVE_VERSION)
        throw new Error(`unknown save version: ${data.version}`);
    return data;
}
/** 保存できたら true（容量オーバーなどで失敗したら false） */
export function saveWorld(id, data) {
    try {
        localStorage.setItem(dataKey(id), JSON.stringify(data));
        writeIndex(listWorlds().map((w) => (w.id === id ? { ...w, savedAt: Date.now() } : w)));
        return true;
    }
    catch (e) {
        console.error('セーブに失敗しました', e);
        return false;
    }
}
export function deleteWorld(id) {
    localStorage.removeItem(dataKey(id));
    writeIndex(listWorlds().filter((w) => w.id !== id));
}
