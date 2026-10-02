import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { toon } from './materials.js';
import { RAPIER, COLLIDE, type Physics } from './physics.js';

const PICKUP_REACH = 3.6; // 視線の先、この距離までの木材を拾える
const FLY_TIME = 0.22; // 拾ったときに吸い寄せられる時間
const PIECE_RADIUS = 0.16;
const PIECE_LENGTH = 0.75;
const SCREEN_CENTER = new THREE.Vector2(0, 0);
// 側面は樹皮、切り口は明るい色
const pieceGeo = new THREE.CylinderGeometry(PIECE_RADIUS, PIECE_RADIUS, PIECE_LENGTH, 7);
const pieceMats = [toon(PALETTE.trunk), toon(PALETTE.sand), toon(PALETTE.sand)];
// 当たり判定も見た目と同じ七角柱にする（真円だといつまでも転がり続ける）
const pieceHull = pieceGeo.getAttribute('position').array as Float32Array;

/** 木材1個の見た目（軸は Y） */
export function woodPiece(): THREE.Mesh {
  return new THREE.Mesh(pieceGeo, pieceMats);
}

interface Piece {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody | null; // 拾われて吸い寄せ中は null
  flying: number; // 吸い寄せ中の経過時間
  from: THREE.Vector3;
}

/** 地面に散らばる木材（物理で転がる）。視線を合わせて F で回収する */
export class WoodDrops {
  private readonly pieces: Piece[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly target = new THREE.Vector3();

  /** 1個回収するたびに呼ばれる */
  onCollect: () => void = () => {};

  constructor(
    private readonly world: THREE.Object3D,
    private readonly physics: Physics,
  ) {
    this.raycaster.far = PICKUP_REACH;
  }

  /** 幹を count 個の木材に切り分けて弾けさせる */
  spawn(trunk: THREE.Mesh, count: number): void {
    trunk.updateWorldMatrix(true, false);
    const height = (trunk.geometry as THREE.CylinderGeometry).parameters.height;
    const rotation = trunk.getWorldQuaternion(new THREE.Quaternion());
    const center = trunk.localToWorld(new THREE.Vector3());
    for (let n = 0; n < count; n++) {
      const pos = trunk.localToWorld(new THREE.Vector3(0, ((n + 0.5) / count - 0.5) * height, 0));
      pos.y += 0.3;
      const body = this.add(pos, rotation);
      // 丸太の中心から外へ弾ける
      const out = pos.clone().sub(center).setY(0);
      if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      out.normalize().multiplyScalar(1 + Math.random() * 1.5);
      body.setLinvel({ x: out.x + (Math.random() - 0.5), y: 3 + Math.random() * 2, z: out.z + (Math.random() - 0.5) }, true);
      body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 8 }, true);
    }
  }

  /** 地面にある木材それぞれの位置・向き [x, y, z, qx, qy, qz, qw] */
  serialize(): number[][] {
    // 吸い寄せ中のものはまだインベントリに入っていないので、その場に落ちているものとして保存する
    return this.pieces.map(({ mesh: { position: p, quaternion: q } }) => [p.x, p.y, p.z, q.x, q.y, q.z, q.w]);
  }

  restore(saves: number[][]): void {
    for (const [x, y, z, qx, qy, qz, qw] of saves) {
      this.add(new THREE.Vector3(x, y, z), new THREE.Quaternion(qx, qy, qz, qw));
    }
  }

  private add(pos: THREE.Vector3, rotation: THREE.Quaternion): RAPIER.RigidBody {
    const mesh = woodPiece();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.world.add(mesh);

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(rotation)
        .setLinearDamping(0.2)
        .setAngularDamping(0.8)
        .setCcdEnabled(true),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.convexHull(pieceHull)!
        .setCollisionGroups(COLLIDE.piece)
        .setDensity(400)
        .setFriction(0.8)
        .setRestitution(0.2),
      body,
    );
    this.physics.link(body, mesh);
    this.physics.addFloater(body, PIECE_RADIUS);
    mesh.position.copy(pos);
    mesh.quaternion.copy(rotation);
    this.pieces.push({ mesh, body, flying: 0, from: new THREE.Vector3() });
    return body;
  }

  /** 画面中央で狙っている木材（届く距離のもの） */
  private aimed(camera: THREE.Camera): Piece | undefined {
    this.raycaster.setFromCamera(SCREEN_CENTER, camera);
    const meshes = this.pieces.filter((p) => p.body).map((p) => p.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit && this.pieces.find((p) => p.mesh === hit.object);
  }

  /** 拾える木材に視線が合っているか */
  isAiming(camera: THREE.Camera): boolean {
    return this.aimed(camera) !== undefined;
  }

  /** 狙っている木材を1つ拾う。拾えたら true */
  collect(camera: THREE.Camera): boolean {
    const p = this.aimed(camera);
    if (!p || !p.body) return false;
    this.physics.removeBody(p.body);
    p.body = null;
    p.from.copy(p.mesh.position);
    return true;
  }

  /** player はカメラ（目）の位置 */
  update(dt: number, player: THREE.Vector3): void {
    this.target.copy(player).y -= 0.6;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      if (p.body) continue; // 地面にある間は物理が動かす
      p.flying += dt;
      const k = Math.min(p.flying / FLY_TIME, 1);
      p.mesh.position.lerpVectors(p.from, this.target, k * k);
      p.mesh.position.y += Math.sin(k * Math.PI) * 0.6; // 少し弧を描く
      p.mesh.scale.setScalar(1 - k * 0.6);
      if (k >= 1) {
        p.mesh.removeFromParent();
        this.pieces.splice(i, 1);
        this.onCollect();
      }
    }
  }
}
