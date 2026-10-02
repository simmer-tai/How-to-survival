import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { toon } from './materials.js';
import { buildLeafModel } from './itemModels.js';
const REACH = 3.2; // 視線の先、この距離までの茂みから採れる
const HARVESTS = 3; // 何回採ると茂みが丸裸になるか
const REGROW_TIME = 90; // 丸裸になってから生え直すまで（秒）
const GROW_TIME = 1.5; // 生え直すのにかかる時間
const SHAKE_TIME = 0.35; // 採ったときに揺れる時間
const SHRINK_TIME = 0.3; // 採り尽くして縮んで消えるまで
const LEAF_PARTICLES = 7;
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const twigGeo = new THREE.BoxGeometry(0.03, 0.03, 0.22);
/** 茂みに視線を合わせて F で葉っぱと枝を採る。採り尽くした茂みはしばらくすると生え直す */
export class BushForager {
    world;
    states = new Map();
    raycaster = new THREE.Raycaster();
    particles = [];
    /** 採れたアイテムごとに呼ばれる */
    onHarvest = () => { };
    constructor(world, bushes) {
        this.world = world;
        for (const mesh of bushes) {
            this.states.set(mesh, { mesh, baseScale: mesh.scale.clone(), phase: 'full', left: HARVESTS, time: 0, shake: 0 });
        }
        this.raycaster.far = REACH;
    }
    /** 画面中央で狙っている、採れる茂み */
    aimed(camera) {
        this.raycaster.setFromCamera(SCREEN_CENTER, camera);
        const targets = [];
        for (const [mesh, s] of this.states)
            if (s.phase === 'full')
                targets.push(mesh);
        const hit = this.raycaster.intersectObjects(targets, false)[0];
        return hit && this.states.get(hit.object);
    }
    /** 採れる茂みに視線が合っているか */
    isAiming(camera) {
        return this.aimed(camera) !== undefined;
    }
    /** 狙っている茂みから葉っぱと枝を採る。採れたら true */
    harvest(camera) {
        const s = this.aimed(camera);
        if (!s)
            return false;
        s.left--;
        s.shake = SHAKE_TIME;
        this.spawnParticles(s.mesh);
        // 葉っぱは毎回 1〜2 枚、枝はときどき（最後の1回は必ず）
        this.onHarvest('leaf', 1 + (Math.random() < 0.5 ? 1 : 0));
        if (s.left === 0 || Math.random() < 0.5)
            this.onHarvest('stick', 1);
        if (s.left === 0) {
            s.phase = 'shrinking';
            s.time = 0;
        }
        return true;
    }
    serialize() {
        return [...this.states.values()].map((s) => {
            if (s.phase === 'full')
                return { left: s.left, time: 0 };
            if (s.phase === 'growing')
                return { left: HARVESTS, time: 0 };
            return { left: 0, time: s.phase === 'gone' ? s.time : 0 };
        });
    }
    /** 生成直後（すべて採れる状態）に呼ぶ */
    restore(saves) {
        [...this.states.values()].forEach((s, i) => {
            const save = saves[i];
            if (!save)
                return;
            s.left = save.left;
            if (save.left > 0)
                return;
            s.mesh.visible = false;
            s.phase = 'gone';
            s.time = save.time;
        });
    }
    update(dt) {
        for (const s of this.states.values()) {
            s.time += dt;
            const { mesh, baseScale } = s;
            if (s.phase === 'full') {
                if (s.shake <= 0)
                    continue;
                s.shake = Math.max(s.shake - dt, 0);
                const k = s.shake / SHAKE_TIME;
                const wobble = Math.sin(s.shake * 45) * 0.09 * k;
                mesh.scale.set(baseScale.x * (1 + wobble), baseScale.y * (1 - wobble), baseScale.z * (1 + wobble));
            }
            else if (s.phase === 'shrinking') {
                const k = Math.min(s.time / SHRINK_TIME, 1);
                mesh.scale.copy(baseScale).multiplyScalar(1 - k * k);
                if (k >= 1) {
                    mesh.visible = false;
                    s.phase = 'gone';
                    s.time = 0;
                }
            }
            else if (s.phase === 'gone') {
                if (s.time >= REGROW_TIME) {
                    mesh.visible = true;
                    mesh.scale.setScalar(0);
                    s.phase = 'growing';
                    s.time = 0;
                }
            }
            else {
                const k = Math.min(s.time / GROW_TIME, 1);
                mesh.scale.copy(baseScale).multiplyScalar(1 - (1 - k) * (1 - k));
                if (k >= 1) {
                    s.phase = 'full';
                    s.left = HARVESTS;
                    s.time = 0;
                }
            }
        }
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                p.mesh.removeFromParent();
                this.particles.splice(i, 1);
                continue;
            }
            // 葉は空気抵抗でゆっくりひらひら落ちる
            p.velocity.y = Math.max(p.velocity.y - 9 * dt, -1.5);
            p.velocity.x *= 1 - 2 * dt;
            p.velocity.z *= 1 - 2 * dt;
            p.mesh.position.addScaledVector(p.velocity, dt);
            p.mesh.rotation.x += p.spin.x * dt;
            p.mesh.rotation.y += p.spin.y * dt;
            p.mesh.rotation.z += p.spin.z * dt;
        }
    }
    /** 茂みのてっぺんから葉と小枝を舞い上げる */
    spawnParticles(bush) {
        const box = new THREE.Box3().setFromObject(bush);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        for (let n = 0; n < LEAF_PARTICLES; n++) {
            const twig = n === 0;
            const mesh = twig ? new THREE.Mesh(twigGeo, toon(PALETTE.trunk)) : buildLeafModel();
            if (!twig)
                mesh.scale.setScalar(0.55);
            mesh.position.set(center.x + (Math.random() - 0.5) * size.x * 0.6, box.max.y - size.y * 0.2, center.z + (Math.random() - 0.5) * size.z * 0.6);
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
            const velocity = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
            const spin = new THREE.Vector3(Math.random() * 8, Math.random() * 4, Math.random() * 8);
            this.world.add(mesh);
            this.particles.push({ mesh, velocity, spin, life: 0.9 + Math.random() * 0.5 });
        }
    }
}
