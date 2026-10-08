// 地形のメモ。海の向こうの島にある地形の話で、街の地図屋からコインで買う。
// 製図台で白紙の地図と組み合わせると、島の地図になる（items/islandChart.ts）

/** メモに出てくる地形。島の地図の中身はこの並びの番号で持つので、新しい地形はかならず後ろに足す（並べ替えない） */
export const LAND_KINDS = ['forest', 'meadow', 'beach', 'crag', 'lake', 'cliff', 'torrent', 'bamboo', 'reef', 'stream', 'hollow', 'iron'] as const;

export type LandKind = (typeof LAND_KINDS)[number];

/** 地形の名前（メモでの呼び名） */
export const LAND_NAMES: Record<LandKind, string> = {
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
  iron: '鉄鉱脈', // 洞窟に鉄鉱石が出る
};

/** メモのアイテムの id */
export type LandInfoId = `${LandKind}Info`;

export const landInfoId = (kind: LandKind): LandInfoId => `${kind}Info`;

/** メモのアイテムの名前 */
export const landInfoName = (kind: LandKind): string => `「${LAND_NAMES[kind]}」のメモ`;

/** メモのアイテムの id の一覧 */
export const LAND_INFO_IDS: LandInfoId[] = LAND_KINDS.map(landInfoId);

/** メモのアイテムごとに make(地形) の値を入れた表（アイコンや手に持つ見た目の表に混ぜる） */
export function perLandInfo<T>(make: (kind: LandKind) => T): Record<LandInfoId, T> {
  return Object.fromEntries(LAND_KINDS.map((k) => [landInfoId(k), make(k)])) as Record<LandInfoId, T>;
}
