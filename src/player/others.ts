import * as THREE from 'three';
import { Avatar, type AvatarLook, type AvatarPose, type AvatarSwing } from './avatar.js';
import type { PoseMsg } from '../net/protocol.js';
import type { LocationId } from '../world/location.js';

const FOLLOW = 12; // 届いた位置・向きへ追いつく速さ（毎秒数回しか届かないので、あいだをなめらかにつなぐ）
const SNAP_DIST = 6; // 届いた位置がこれより離れていたら、追いかけずにその場へ移す（船で渡ったときなど）
const TAG_HEIGHT = 2.1; // 名札を出す、足元からの高さ
const TAG_PX = 40; // 名札の文字の大きさ（キャンバスの px）
const TAG_METERS = 0.28; // 名札の文字の高さ（m）

/** 部屋にいるほかの人1人 */
interface Other {
  name: string;
  avatar: Avatar;
  tag: THREE.Sprite;
  /** 今描いている体の様子（届いた様子へ少しずつ寄せる） */
  pose: AvatarPose;
  /** 最後に届いた様子（まだ届いていなければ null） */
  target: PoseMsg | null;
}

/** -π〜π に収める */
function wrap(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

/** 頭の上に出す名札（文字を描いたキャンバスを板にする） */
function nameTag(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `700 ${TAG_PX}px system-ui, sans-serif`;
  ctx.font = font;
  const pad = TAG_PX * 0.4;
  canvas.width = Math.ceil(ctx.measureText(name).width + pad * 2);
  canvas.height = Math.ceil(TAG_PX * 1.5);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = TAG_PX * 0.2;
  ctx.strokeStyle = '#2b2633';
  ctx.strokeText(name, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = '#fff';
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, fog: false }));
  const h = (TAG_METERS * canvas.height) / TAG_PX;
  sprite.scale.set((h * canvas.width) / canvas.height, h, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/**
 * マルチで同じ部屋にいる、ほかの人の体と名札（自分の画面だけの描画）。
 * 体の見た目と動きは自分の体と同じ Avatar で描き、届いた様子（PoseMsg）へなめらかに寄せる。
 * 自分と違う場所（島・街）にいる人は描かない
 */
export class OtherPlayers {
  private readonly group = new THREE.Group();
  private readonly list = new Map<number, Other>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** 部屋にいる人の名前（番号順） */
  get names(): string[] {
    return [...this.list.entries()].sort(([a], [b]) => a - b).map(([, o]) => o.name);
  }

  /** 人を足す。もういれば名前と見た目を変える */
  set(id: number, name: string, look: AvatarLook): void {
    const o = this.list.get(id);
    if (!o) {
      const avatar = new Avatar(look, 0);
      const tag = nameTag(name);
      avatar.object.visible = false; // 様子が届くまでは出さない
      tag.visible = false;
      this.group.add(avatar.object, tag);
      const pose: AvatarPose = { p: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 0, state: 'ground', crouch: 0 };
      this.list.set(id, { name, avatar, tag, pose, target: null });
      return;
    }
    const lookChanged = JSON.stringify(o.avatar.currentLook) !== JSON.stringify(look);
    if (lookChanged) o.avatar.setLook(look);
    if (o.name !== name) {
      o.name = name;
      this.group.remove(o.tag);
      disposeTag(o.tag);
      o.tag = nameTag(name);
      this.group.add(o.tag);
    }
  }

  remove(id: number): void {
    const o = this.list.get(id);
    if (!o) return;
    this.list.delete(id);
    this.group.remove(o.avatar.object, o.tag);
    o.avatar.object.traverse((m) => {
      if (m instanceof THREE.Mesh) m.geometry.dispose();
    });
    disposeTag(o.tag);
  }

  clear(): void {
    for (const id of [...this.list.keys()]) this.remove(id);
  }

  /** その人から届いた様子 */
  setPose(id: number, pose: PoseMsg): void {
    const o = this.list.get(id);
    if (!o || !pose.p?.every(Number.isFinite)) return;
    const far = o.target === null || o.pose.p.distanceTo(new THREE.Vector3(...pose.p)) > SNAP_DIST;
    o.target = pose;
    if (far) {
      o.pose.p.set(...pose.p);
      o.pose.yaw = pose.yaw;
    }
    o.avatar.setHeld(pose.held);
    o.avatar.setCharge(pose.charge);
  }

  swing(id: number, kind: AvatarSwing): void {
    this.list.get(id)?.avatar.swing(kind);
  }

  /** here の場所にいる人の名前と位置（地図に描く） */
  spots(here: LocationId): { name: string; x: number; z: number }[] {
    return [...this.list.values()].filter((o) => o.target?.loc === here).map((o) => ({ name: o.name, x: o.pose.p.x, z: o.pose.p.z }));
  }

  /** here は自分がいる場所（同じ場所にいる人だけを描く） */
  update(dt: number, here: LocationId): void {
    const k = 1 - Math.exp(-FOLLOW * dt);
    for (const o of this.list.values()) {
      const t = o.target;
      const shown = t !== null && t.loc === here;
      o.avatar.object.visible = shown;
      o.tag.visible = shown;
      if (!t || !shown) continue;
      const pose = o.pose;
      pose.p.lerp(new THREE.Vector3(...t.p), k);
      pose.yaw += wrap(t.yaw - pose.yaw) * k;
      pose.pitch += (t.pitch - pose.pitch) * k;
      pose.speed = t.speed;
      pose.state = t.state;
      pose.crouch = t.crouch;
      if (t.body === undefined) delete pose.bodyYaw;
      else pose.bodyYaw = pose.bodyYaw === undefined ? t.body : pose.bodyYaw + wrap(t.body - pose.bodyYaw) * k;
      o.avatar.update(dt, pose);
      o.tag.position.set(pose.p.x, pose.p.y + TAG_HEIGHT, pose.p.z);
    }
  }
}

function disposeTag(tag: THREE.Sprite): void {
  tag.material.map?.dispose();
  tag.material.dispose();
}
