// ワールドはブラウザの localStorage に保存する（ページの URL のオリジンごとに別々になる）。
// 地形や木・茂みの配置は固定シードで毎回同じに生成されるので、変化した状態だけを持つ
export const SAVE_VERSION = 1;
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
    const data = JSON.parse(json);
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
