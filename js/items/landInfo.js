// 地形のメモ。海の向こうの島にある地形の話で、街の地図屋からコインで買う。
// 今はアイテムとして持てるだけ。あとで、いくつかを組み合わせて島の地図を作れるようにする
// （組み合わせたメモがそのまま島に出るとは限らない）
/** メモに出てくる地形（並びは地図屋の売り物の並び） */
export const LAND_KINDS = ['forest', 'meadow', 'beach', 'crag', 'lake', 'cliff', 'torrent', 'bamboo', 'reef', 'stream', 'hollow'];
/** 地形の名前（メモでの呼び名） */
export const LAND_NAMES = {
    forest: '木々の海', // 森林
    meadow: '風の原', // 草原
    beach: '白い渚', // 砂浜
    crag: '灰の牙', // 岩場
    lake: '空を映す水', // 湖
    cliff: '切り立つ岸', // 崖
    torrent: '激流', // 滝
    bamboo: '笹', // 竹林
    reef: '船喰い', // 岩礁
    stream: '水流', // 川
    hollow: '空洞', // 洞窟
};
export const landInfoId = (kind) => `${kind}Info`;
/** メモのアイテムの名前 */
export const landInfoName = (kind) => `「${LAND_NAMES[kind]}」のメモ`;
/** メモのアイテムの id の一覧 */
export const LAND_INFO_IDS = LAND_KINDS.map(landInfoId);
/** メモのアイテムごとに make(地形) の値を入れた表（アイコンや手に持つ見た目の表に混ぜる） */
export function perLandInfo(make) {
    return Object.fromEntries(LAND_KINDS.map((k) => [landInfoId(k), make(k)]));
}
