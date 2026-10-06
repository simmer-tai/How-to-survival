// 場所（島・街）。どの場所も WORLD_SIZE 四方で中心が原点の、別々の場面として扱う。
// プレイヤーはどれか1つの場所にいて、その場所だけを描き、その場所の物とだけぶつかる（自分の画面の切り替え）。
// どの場所の状態も共有ワールドの一部で、マルチではホストが全部の場所の状態を持つ
export const LOCATIONS = {
    island: { id: 'island', name: '自分の島', chart: [0.3, 0.55], chartSize: 0.22 },
    town: { id: 'town', name: '街', chart: [0.74, 0.4], chartSize: 0.12 },
};
/** セーブデータなどから読んだ値を場所にする（知らない値なら島） */
export function toLocation(id) {
    return id === 'town' ? 'town' : 'island';
}
