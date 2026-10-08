import * as THREE from 'three';
import type { Tree } from './props.js';
import type { LocationId } from './location.js';

const TREE_LOW = 55; // カメラからこれより遠い木は、面の少ない形（Tree.far）で描く
const TREE_HIDE_MARGIN = 8; // 霧に溶けきる距離からさらにこれだけ遠い木は描かない（木の枝張りの分）
const BUSH_LOW = 35; // これより遠い茂みは、面の少ない形（userData.low）で描く
const BUSH_SHADOW = 50; // これより遠い茂みは影を落とさない
const ROCK_SHADOW = 60; // これより遠い岩は影を落とさない
const HYSTERESIS = 2; // 境目の前後でちらつかないように、近い形へ戻すときはこれだけ近づいてから（m）

/** 木の描き方：0 = 元の形、1 = 面の少ない形、2 = 描かない */
interface TreeEntry { tree: Tree; x: number; z: number; level: number }
/** 茂みの描き方：0 = 元の形、1 = 面の少ない形、2 = 面の少ない形で影を落とさない */
interface BushEntry { mesh: THREE.Mesh; high: THREE.BufferGeometry; low: THREE.BufferGeometry; x: number; z: number; level: number }
/** 岩の描き方：0 = 影を落とす、1 = 落とさない */
interface RockEntry { mesh: THREE.Mesh; x: number; z: number; level: number }

interface Bucket { trees: TreeEntry[]; bushes: BushEntry[]; rocks: RockEntry[] }

/**
 * 距離で描き方を変える（LOD）。遠くの木・茂みは面の少ない形にし、影を落とす物を減らし、霧に溶けた木は描かない。
 * 自分の画面だけの見た目で、共有ワールドの状態は変えない。木の幹・crown・far と茂みのジオメトリ・影だけを触る
 * （visible は採取・採掘が使うので、茂みと岩では触らない）。場所ごとに分けて持ち、今いる場所の分だけ毎フレーム測る
 */
export class Lod {
  private readonly buckets = new Map<LocationId, Bucket>();

  private bucket(loc: LocationId): Bucket {
    let b = this.buckets.get(loc);
    if (!b) this.buckets.set(loc, (b = { trees: [], bushes: [], rocks: [] }));
    return b;
  }

  /** 場所 loc の木・茂み・岩をまとめて足す */
  addProps(loc: LocationId, props: { trees: Tree[]; bushes: THREE.Mesh[]; rocks: THREE.Mesh[] }): void {
    for (const tree of props.trees) this.addTree(loc, tree);
    for (const bush of props.bushes) this.addBush(loc, bush);
    for (const rock of props.rocks) this.addRock(loc, rock);
  }

  /** 立っている木を足す（あとから植えた木も。置き場所に入れてから呼ぶ） */
  addTree(loc: LocationId, tree: Tree): void {
    const p = tree.object.getWorldPosition(new THREE.Vector3());
    this.bucket(loc).trees.push({ tree, x: p.x, z: p.z, level: 0 });
  }

  /** 茂みを足す（形を作ったときに userData.low を入れた物だけ。実をつけ終えてから呼ぶ） */
  addBush(loc: LocationId, mesh: THREE.Mesh): void {
    const low = mesh.userData.low as THREE.BufferGeometry | undefined;
    if (!low) return;
    const p = mesh.getWorldPosition(new THREE.Vector3());
    this.bucket(loc).bushes.push({ mesh, high: mesh.geometry, low, x: p.x, z: p.z, level: 0 });
  }

  addRock(loc: LocationId, mesh: THREE.Mesh): void {
    const p = mesh.getWorldPosition(new THREE.Vector3());
    this.bucket(loc).rocks.push({ mesh, x: p.x, z: p.z, level: 0 });
  }

  /** camera はカメラの位置、loc は今いる場所、fogFar は霧に溶けきる距離、scale は画質で決まる境目の距離の倍率 */
  update(camera: THREE.Vector3, loc: LocationId, fogFar: number, scale = 1): void {
    const b = this.buckets.get(loc);
    if (!b) return;
    const treeLow = TREE_LOW * scale;
    const hide = Math.max(fogFar + TREE_HIDE_MARGIN, treeLow + HYSTERESIS * 3);
    const treeEdges = [treeLow, hide];
    const bushEdges = [BUSH_LOW * scale, BUSH_SHADOW * scale];
    const rockEdges = [ROCK_SHADOW * scale];

    b.trees = b.trees.filter((e) => {
      const { tree } = e;
      // 倒れた木（伐採で crown と far を外す）は、もう見ない
      if (!tree.crown.parent || !tree.object.parent) return false;
      const level = levelAt(Math.hypot(e.x - camera.x, e.z - camera.z), treeEdges, e.level);
      if (level !== e.level) {
        e.level = level;
        tree.trunk.visible = level === 0;
        tree.crown.visible = level === 0;
        tree.far.visible = level === 1;
      }
      return true;
    });

    b.bushes = b.bushes.filter((e) => {
      if (!e.mesh.parent) return false;
      const level = levelAt(Math.hypot(e.x - camera.x, e.z - camera.z), bushEdges, e.level);
      if (level !== e.level) {
        e.level = level;
        e.mesh.geometry = level === 0 ? e.high : e.low;
        e.mesh.castShadow = level < 2;
      }
      return true;
    });

    b.rocks = b.rocks.filter((e) => {
      if (!e.mesh.parent) return false;
      const level = levelAt(Math.hypot(e.x - camera.x, e.z - camera.z), rockEdges, e.level);
      if (level !== e.level) {
        e.level = level;
        e.mesh.castShadow = level === 0;
      }
      return true;
    });
  }
}

/**
 * 距離 d での描き方の段階（edges は段階の境目の距離。小さい順）。
 * 今の段階 current より遠くへ移るのは境目より HYSTERESIS 遠くなってから、近くへ戻るのは HYSTERESIS 近づいてから
 */
function levelAt(d: number, edges: number[], current: number): number {
  let level = 0;
  for (let i = 0; i < edges.length; i++) {
    if (d > edges[i] + (i < current ? -HYSTERESIS : HYSTERESIS)) level = i + 1;
  }
  return level;
}
