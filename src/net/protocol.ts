// マルチプレイで送り合うメッセージの形。
// ホストのブラウザと参加者のブラウザが、PeerJS（WebRTC）で直接 JSON を送り合う（つなぎ方は link.ts）。
// 参加者どうしは直接やりとりせず、いつもホストを通す（ホストが世界の正しい状態を持つ）

import type { WorldCommand, WorldRequest } from '../core/commands.js';
import type { SharedWorld } from '../core/save.js';
import type { AvatarLook, AvatarPose, AvatarSwing } from '../player/avatar.js';
import type { LocationId } from '../world/location.js';

/** 部屋にいる人。id はホストの部屋（link.ts）が付ける番号（ホストは 0、参加者は 1 から） */
export interface PeerInfo { id: number; name: string; look: AvatarLook }

/** 部屋を開いているワールド */
export interface RoomWorld { id: string; name: string }

/** 他の人に見せる自分の様子（毎秒数回送る） */
export interface PoseMsg {
  /** 足元の位置 */
  p: [number, number, number];
  yaw: number;
  pitch: number;
  speed: number;
  state: AvatarPose['state'];
  crouch: number;
  /** 体の向き（船に座っているとき） */
  body?: number;
  /** 手に持っている物（ITEMS の id） */
  held: string | null;
  /** 槍を投げる力を溜めている具合（溜めていなければ null） */
  charge: number | null;
  /** いる場所 */
  loc: LocationId;
  /** 乗って漕いでいる船 [番号, x, z, yaw]（漕いでいる間の船の位置は、乗っている人が決めて配る） */
  boat?: [number, number, number, number];
}

/** 参加者からホストへ */
export type GuestMsg =
  /** 部屋に入ったら最初に送る（名前と見た目） */
  | { t: 'hello'; name: string; look: AvatarLook }
  /** 共有ワールドへの頼み。n は返事（断られたとき）と結びつける通し番号 */
  | { t: 'req'; n: number; req: WorldRequest }
  | { t: 'pose'; pose: PoseMsg }
  | { t: 'look'; look: AvatarLook }
  | { t: 'swing'; kind: AvatarSwing };

/** ホストの部屋（link.ts の HostLink）が届ける形（from は送った参加者。join・leave はつながり・切れたときに HostLink が知らせる） */
export interface FromGuest { from: number; data: GuestMsg | { t: 'join' } | { t: 'leave' } }

/**
 * 動いている物の位置（ホストの物理で決めた値）。中身は drops.motion()・chopper.motion() の形。
 * isles は海図に載せた島の分で、[島の番号, 落とし物, 木] の並び（world/isles.ts の motion()）
 */
export interface Motion { drops: number[][]; trees: number[][]; isles?: [number, number[][], number[][]][] }

/** ホストから参加者へ */
export type HostMsg =
  /** 部屋に入った人へ、世界のまるごとの状態と、部屋にいる人を送る */
  | { t: 'world'; you: number; world: RoomWorld; data: SharedWorld; peers: PeerInfo[] }
  /** 適用するコマンド。by は頼んだ人（世界が出した頼みなら null）。n は頼んだ人の頼みの通し番号 */
  | { t: 'cmd'; cmd: WorldCommand; by: number | null; n?: number }
  /** 頼み n を断った（頼んだ人にだけ送る） */
  | { t: 'reject'; n: number }
  /** ワールドの時刻 */
  | { t: 'clock'; minutes: number }
  | ({ t: 'motion' } & Motion)
  | { t: 'pose'; id: number; pose: PoseMsg }
  /** 人が入った・見た目を変えた */
  | { t: 'peer'; peer: PeerInfo }
  /** 人が抜けた */
  | { t: 'gone'; id: number }
  | { t: 'swing'; id: number; kind: AvatarSwing };

/** ホストが送るときの宛先（to の人へ data を届ける。'all' なら except 以外の全員） */
export interface ToGuests { to: number | 'all'; except?: number; data: HostMsg }

/** つながり（link.ts）の決まりごととしてホストから届くもの */
export type ServerMsg =
  /** 部屋に入れた。id は自分の番号 */
  | { t: 'welcome'; id: number }
  /** 部屋に入れなかった（full：部屋がいっぱい） */
  | { t: 'error'; reason: 'full' }
  /** ホストが部屋を閉じた */
  | { t: 'hostLeft' };
