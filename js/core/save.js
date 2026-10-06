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
export const SAVE_VERSION = 23;
/** 自分だけの状態（マルチでは各自のブラウザに残す） */
export const PERSONAL_KEYS = ['player', 'inventory', 'vitals', 'guide', 'recipes'];
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
/** 11 → 12：頼みごとは最初から。持ち物で達成済みの目標は、読み込んだあとにすぐ進む */
function fromV11(old) {
    return { ...old, version: 12, guide: { step: 0 } };
}
/** 12 → 13：お金は 0 枚から。インベントリに残っている貝貨は、同じ枚数のコインに換える */
function fromV12(old) {
    let coins = 0;
    const slots = old.inventory.slots.map((s) => {
        if (s?.item !== 'shell')
            return s;
        coins += s.count;
        return null;
    });
    return { ...old, version: 13, inventory: { ...old.inventory, slots }, wallet: { coins } };
}
/** 13 → 14：wallet のお金を、インベントリのお金のマスのコインにする */
function fromV13({ wallet, ...old }) {
    const coins = Math.min(wallet.coins, ITEMS.coin.maxStack);
    return { ...old, version: 14, inventory: { ...old.inventory, purse: coins > 0 ? { item: 'coin', count: coins } : null } };
}
/** 14 → 15：まだ何も覚えていないとして読む */
function fromV14(old) {
    return { ...old, version: 15, recipes: [] };
}
/** 15 → 16：船はまだ1つも浮かべていないとして読む */
function fromV15(old) {
    return { ...old, version: 16, boats: { next: 0, list: [] } };
}
/** 16 → 17：boat がないプレイヤーは船に乗っていないとして読めるので、形はそのまま */
function fromV16(old) {
    return { ...old, version: 17 };
}
/** 17 → 18：刺さった槍はまだない */
function fromV17(old) {
    return { ...old, version: 18, spears: { next: 0, list: [] } };
}
/** 18 → 19：loc がない船とプレイヤーは自分の島にいるとして読めるので、形はそのまま */
function fromV18(old) {
    return { ...old, version: 19 };
}
/** 19 → 20：天気は時刻から決まる、ふだんの天気のまま */
function fromV19(old) {
    return { ...old, version: 20, weather: null };
}
/** 20 → 21：穴はまだ1つも掘っていない */
function fromV20(old) {
    return { ...old, version: 21, holes: { next: 0, list: [] } };
}
/** 21 → 22：t がない穴は掘ったばかりとして読めるので、形はそのまま */
function fromV21(old) {
    return { ...old, version: 22 };
}
/** 22 → 23：焚火はまだ1つも置いていない */
function fromV22(old) {
    return { ...old, version: 23, fires: [] };
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
    if (data.version === 11)
        data = fromV11(data);
    if (data.version === 12)
        data = fromV12(data);
    if (data.version === 13)
        data = fromV13(data);
    if (data.version === 14)
        data = fromV14(data);
    if (data.version === 15)
        data = fromV15(data);
    if (data.version === 16)
        data = fromV16(data);
    if (data.version === 17)
        data = fromV17(data);
    if (data.version === 18)
        data = fromV18(data);
    if (data.version === 19)
        data = fromV19(data);
    if (data.version === 20)
        data = fromV20(data);
    if (data.version === 21)
        data = fromV21(data);
    if (data.version === 22)
        data = fromV22(data);
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
// ---- マルチの参加者：ほかの人のワールドで遊んだときの、自分だけの状態（位置・持ち物など） ----
// 共有ワールドはホストのブラウザにセーブされるので、参加者は自分だけの状態だけを、ホストのワールドの id ごとに残す
const guestKey = (worldId) => `warfarming:guest:${worldId}`;
/** そのワールドに参加したときの自分だけの状態（初めてなら、読めなければ null） */
export function loadGuest(worldId) {
    try {
        const data = JSON.parse(localStorage.getItem(guestKey(worldId)) ?? 'null');
        return data?.version === SAVE_VERSION ? data : null;
    }
    catch {
        return null;
    }
}
/** 保存できたら true */
export function saveGuest(worldId, data) {
    try {
        localStorage.setItem(guestKey(worldId), JSON.stringify({ version: SAVE_VERSION, ...data }));
        return true;
    }
    catch (e) {
        console.error('セーブに失敗しました', e);
        return false;
    }
}
