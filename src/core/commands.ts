// ワールドコマンド：共有ワールドを変える操作を小さなデータにしたもの。
// 入力側は「頼み（リクエスト）」を作るだけにし、ホストがそれを確かめて ID などを決めた「コマンド」にして、
// 全員がそのコマンドを同じように適用する。ひとりで遊ぶときは自分がホストなので、その場で確かめて適用する

/** 部材を置く。pid はホストが発行する部材の通し番号、p は底面中央の位置、r は 90° 単位の向き */
export interface PlacePiece { type: 'placePiece'; pid: number; id: string; p: [number, number, number]; r: number }

/** 部材を取り除く */
export interface RemovePiece { type: 'removePiece'; pid: number }

/** 部材を叩くのに使った物 */
export type StrikeTool = 'axe' | 'fist';

/** 部材を叩いて耐久値を damage だけ減らす（0 になったら壊れる）。damage はホストが道具から決める */
export interface HitPiece { type: 'hitPiece'; pid: number; damage: number }

/**
 * アイテムを地面に落とす。did はホストが発行する落とし物の通し番号、p は出てくる位置、v は投げ出す速さ。
 * dmg は使いかけの道具の減った耐久値（拾い直しても耐久値が戻らないように、落とし物にも持たせる）
 */
export interface DropItem { type: 'dropItem'; did: number; item: string; count: number; dmg?: number; p: [number, number, number]; v: [number, number, number] }

/** 落ちている物を count 個拾う（全部拾うと消える） */
export interface PickDrop { type: 'pickDrop'; did: number; count: number }

/** 茂みを叩くのに使った物。knife（石のナイフ）で叩くとツルも採れる */
export type HarvestTool = 'fist' | 'knife' | 'axe';

/**
 * 茂みを1回叩いて耐久値を damage だけ減らす。bush は茂みの番号。
 * items はその1回で採れる物と個数（減った耐久値の割合で少しずつ出る）。damage と items は道具からホストが決める
 */
export interface HarvestBush { type: 'harvestBush'; bush: number; damage: number; items: [string, number][] }

/** 茂みになっている実を1つ摘む */
export interface PickBerry { type: 'pickBerry'; bush: number }

/** 岩を叩くのに使った物 */
export type MineTool = 'pickaxe';

/**
 * 岩を1回叩いて耐久値を damage だけ減らす（0 になったら崩れてなくなる）。rock は岩の番号。
 * items はその1回で採れる物と個数（叩くたびに少しずつ、壊したときにまとめて出る）。damage と items は道具からホストが決める
 */
export interface MineRock { type: 'mineRock'; rock: number; damage: number; items: [string, number][] }

export type PieceCommand = PlacePiece | RemovePiece | HitPiece;
export type DropCommand = DropItem | PickDrop;
export type WorldCommand = PieceCommand | DropCommand | HarvestBush | PickBerry | MineRock;

/** 参加者からホストへの頼み。新しく増える物の ID はホストが付けるので、まだ持たない */
export type PieceRequest = Omit<PlacePiece, 'pid'> | RemovePiece | { type: 'hitPiece'; pid: number; tool: StrikeTool };
export type DropRequest = Omit<DropItem, 'did'> | PickDrop;
export type BushRequest = { type: 'harvestBush'; bush: number; tool: HarvestTool } | PickBerry;
export type RockRequest = { type: 'mineRock'; rock: number; tool: MineTool };
export type WorldRequest = PieceRequest | DropRequest | BushRequest | RockRequest;
