import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
// 叩いた物の上に浮かぶダメージの数（自分の画面だけの UI。同期しない）。
// 3D の位置を毎フレーム画面に映し、上へ浮かびながら消える
const LIFE = 0.9; // 出してから消えるまでの時間（秒）
const RISE = 0.55; // 消えるまでに浮かぶ高さ（m）
const SPREAD = 0.12; // 出す位置を横にずらす幅（m。続けて叩いても重ならないように）
const POP = 0.12; // 出た直後に大きく見せる時間（秒）
const POP_SCALE = 1.5; // 出た直後の大きさの倍率
const FADE = 0.35; // 消える前に薄くなっていく時間（秒）
const css = (c) => '#' + c.toString(16).padStart(6, '0');
export class DamageNumbers {
    root;
    popups = [];
    v = new THREE.Vector3();
    constructor() {
        injectStyle();
        this.root = document.createElement('div');
        this.root.className = 'dmg-layer';
        document.body.append(this.root);
    }
    /** p の上に amount を出す。killed なら倒したときの色で大きく出す */
    spawn(p, amount, killed) {
        const el = document.createElement('div');
        el.className = killed ? 'dmg-num kill' : 'dmg-num';
        el.textContent = String(amount);
        this.root.append(el);
        const a = Math.random() * Math.PI * 2;
        const at = p.clone().add(new THREE.Vector3(Math.cos(a) * SPREAD, 0, Math.sin(a) * SPREAD));
        this.popups.push({ el, at, age: 0 });
    }
    /** 毎フレーム、位置と濃さを決める（カメラの後ろに回った数は隠す） */
    update(dt, camera) {
        for (let i = this.popups.length - 1; i >= 0; i--) {
            const p = this.popups[i];
            p.age += dt;
            if (p.age >= LIFE) {
                p.el.remove();
                this.popups.splice(i, 1);
                continue;
            }
            const t = p.age / LIFE;
            this.v.copy(p.at).setY(p.at.y + RISE * (1 - (1 - t) * (1 - t))).project(camera);
            if (this.v.z > 1) {
                p.el.style.display = 'none';
                continue;
            }
            p.el.style.display = '';
            const scale = p.age < POP ? POP_SCALE - (POP_SCALE - 1) * (p.age / POP) : 1;
            p.el.style.left = `${((this.v.x + 1) / 2) * 100}%`;
            p.el.style.top = `${((1 - this.v.y) / 2) * 100}%`;
            p.el.style.transform = `translate(-50%, -50%) scale(${scale})`;
            p.el.style.opacity = String(Math.min(1, (LIFE - p.age) / FADE));
        }
    }
    /** 出ている数をすべて消す（場所を移るときなど） */
    clear() {
        for (const p of this.popups)
            p.el.remove();
        this.popups.length = 0;
    }
}
let injected = false;
function injectStyle() {
    if (injected)
        return;
    injected = true;
    const ink = '#2b2633';
    const style = document.createElement('style');
    style.textContent = `
    .dmg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 3; overflow: hidden; }
    .dmg-num {
      position: absolute; font-size: calc(22 * var(--u)); font-weight: 900; color: #fff; white-space: nowrap;
      text-shadow: calc(-2 * var(--u)) 0 ${ink}, calc(2 * var(--u)) 0 ${ink}, 0 calc(-2 * var(--u)) ${ink}, 0 calc(2 * var(--u)) ${ink},
        calc(2 * var(--u)) calc(2 * var(--u)) 0 ${ink};
    }
    .dmg-num.kill { font-size: calc(28 * var(--u)); color: ${css(PALETTE.sand)}; }
  `;
    document.head.append(style);
}
