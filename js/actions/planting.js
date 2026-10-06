import * as THREE from 'three';
import { plantedTree } from '../world/props.js';
const GROW_TIME = 2 * 18 * 60; // 苗が育ちきって、斧で切れる木になるまでの時間（秒）。ゲームの中の2日
const SPROUT_SIZE = 0.06; // 生えたばかりの苗の大きさ（育ちきった木に対する割合）
const SWAY_STEP = 0.02; // 大きさがこれだけ変わるたびに、葉の風での揺れ方を大きさに合わせ直す
/** ほかの木の根元とこれより近い所には、種を植えられない（m） */
export const TREE_GAP = 2.5;
/** 種から育てた木の、TreeChopper での木の番号（植えた木の番号に足す。最初から島にある木の番号と重ならないように） */
export const PLANTED_TREE_BASE = 100000;
/**
 * 種から育つ木。穴に木の種を置いて埋めると（digging.ts の onSprout）、そこに小さな苗が生え、時間とともに大きくなる。
 * 育ちきると（growTree）、斧で切り倒せるふつうの木として TreeChopper に渡す。
 * 種類・形は植えた木の番号から決めるので誰の画面でも同じになり、育つ時間は全員が進めて見せる（育ちきったと決めるのはホスト）
 */
export class Saplings {
    world;
    chopper;
    fixedTrees;
    planted = new Map();
    /** 共有ワールドを変える頼みを出す（main.ts が差し替える） */
    request = () => false;
    /** 苗をワールドに足したとき（obj）、育ちきって幹の剛体ができたとき（body）に呼ばれる（街にいる間は隠すため。main.ts が差し替える） */
    onAdd = () => { };
    /** fixedTrees は最初から島にある木（そばに植えられないようにする） */
    constructor(world, chopper, fixedTrees) {
        this.world = world;
        this.chopper = chopper;
        this.fixedTrees = fixedTrees;
        chopper.onRemove = (id) => this.planted.delete(id - PLANTED_TREE_BASE); // 切り倒して丸太をばらし終えたら、植えた木もなくなる
    }
    /** (x, z) から r 以内に、植えた木（苗も）があるか */
    occupied(x, z, r) {
        for (const p of this.planted.values())
            if (Math.hypot(p.x - x, p.z - z) < r)
                return true;
        return false;
    }
    /** (x, z) に種を植えてよいか（植えた木や、最初から島にある木のそばには植えられない） */
    canPlantAt(x, z) {
        if (this.occupied(x, z, TREE_GAP))
            return false;
        return !this.fixedTrees.some((o) => o.parent !== null && Math.hypot(o.position.x - x, o.position.z - z) < TREE_GAP);
    }
    /** 種を置いた穴が埋まって、(x, z) に苗が生える（全員が digHole・fillHole の適用の中で呼ぶ） */
    sprout(gid, x, z, age = 0) {
        if (this.planted.has(gid))
            return;
        const { tree, scale, sway } = plantedTree(gid, x, z);
        const p = { gid, x, z, age, tree, scale, sway, size: -1, swaySize: -1, grown: false };
        this.planted.set(gid, p);
        this.resize(p);
        this.world.add(tree.object);
        this.onAdd(tree.object, null);
    }
    /**
     * 苗を育てる（全員が進めて大きさを見せる）。育ちきった苗は、木にする頼みを出す（世界の頼みなので、マルチではホストのものだけが通る）。
     * 生えてからの時間はセーブに入るので、ロードしたあとも続きから育つ
     */
    tick(dt) {
        for (const p of this.planted.values()) {
            if (p.grown)
                continue;
            p.age += dt;
            this.resize(p);
            if (p.age >= GROW_TIME)
                this.request({ type: 'growTree', gid: p.gid }, null);
        }
    }
    // ---- ホスト側：頼みを確かめてコマンドにする ----
    authorize(req) {
        const p = this.planted.get(req.gid);
        return p && !p.grown ? { type: 'growTree', gid: req.gid } : null;
    }
    // ---- 全員：コマンドを適用する ----
    /** 苗を育ちきった大きさにして、斧で切れる木にする */
    apply(cmd) {
        const p = this.planted.get(cmd.gid);
        if (p && !p.grown)
            this.grow(p);
    }
    grow(p) {
        p.grown = true;
        p.age = Math.max(p.age, GROW_TIME);
        this.resize(p);
        const body = this.chopper.addTree(PLANTED_TREE_BASE + p.gid, p.tree);
        this.onAdd(p.tree.object, body);
    }
    /** 生えてからの時間に合わせて、木の大きさと、葉の風での揺れ方（小さい苗はあまり揺れない）を変える */
    resize(p) {
        const size = THREE.MathUtils.lerp(SPROUT_SIZE, 1, Math.min(p.age / GROW_TIME, 1));
        if (size === p.size)
            return;
        p.size = size;
        p.tree.object.scale.setScalar(p.scale * size);
        if (Math.abs(size - p.swaySize) < SWAY_STEP && size < 1)
            return;
        p.swaySize = size;
        const attr = p.tree.crown.geometry.getAttribute('aSway');
        for (let i = 0; i < attr.count; i++)
            attr.setX(i, p.sway[i] * size);
        attr.needsUpdate = true;
    }
    serialize() {
        const list = [];
        for (const p of this.planted.values()) {
            const save = { gid: p.gid, p: [p.x, p.z], t: Math.round(p.age) };
            if (p.grown) {
                const tree = this.chopper.serializeTree(PLANTED_TREE_BASE + p.gid);
                if (tree === null)
                    continue; // 丸太をばらしている途中の木は、もうないものとする
                save.tree = tree;
            }
            list.push(save);
        }
        return { list };
    }
    /** 生成直後（植えた木が1本もない状態）に、最初から島にある木を戻したあとで呼ぶ */
    restore(save) {
        for (const s of save.list) {
            if (!Number.isInteger(s.gid) || this.planted.has(s.gid) || !Number.isFinite(s.p?.[0]) || !Number.isFinite(s.p?.[1]))
                continue;
            this.sprout(s.gid, s.p[0], s.p[1], Number.isFinite(s.t) ? Math.max(s.t, 0) : 0);
            if (s.tree === undefined)
                continue;
            this.grow(this.planted.get(s.gid));
            this.chopper.restoreTree(PLANTED_TREE_BASE + s.gid, s.tree);
        }
    }
}
