import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
// 街の明かり（街灯のランタンと、地図屋の中のランタン・窓）。暗くなると灯り、明るくなると消える。
// 灯るかどうかは空の明るさ（ワールドの時刻と天気から決まる）だけで決めるので、誰の画面でも同じになる。見た目だけで、セーブする物はない
const ON_DARK = 0.3; // 空の明るさ（Sky.daylight）がこれより暗いと、明かりはいちばん明るく灯る
const OFF_BRIGHT = 0.6; // 空の明るさがこれより明るいと、明かりは消える
const GLASS_GLOW = 1.1; // 灯っているときの、ランタンのガラスと窓の光り方
const FLICKER = 0.06; // 炎のゆらぎで明かりの強さが変わる割合
/** 明かりの色（赤と砂色のあいだの、暖かい色） */
const LIGHT_COLOR = new THREE.Color(PALETTE.accent).lerp(new THREE.Color(PALETTE.sand), 0.6);
/** ランタンのガラスや窓に使う、灯ると光る材質（色は頂点の色。明るさは Lamps.update が変える） */
const glassMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: LIGHT_COLOR, emissiveIntensity: 0 });
/** Batch にまとめたガラスを、灯ると光るメッシュにする */
export function glassMesh(b) {
    const mesh = b.mesh();
    mesh.material = glassMaterial;
    mesh.castShadow = false;
    return mesh;
}
export class Lamps {
    lamps = [];
    /** 今の灯り具合（0 で消えている、1 でいちばん明るい） */
    level = -1;
    /** parent の中の position に明かりを置く。range はとどく距離 */
    add(parent, position, intensity, range) {
        const light = new THREE.PointLight(LIGHT_COLOR, 0, range, 1);
        light.position.copy(position);
        light.visible = false;
        parent.add(light);
        this.lamps.push({ light, intensity, phase: this.lamps.length * 1.7 });
    }
    /** daylight は空の明るさ（Sky.daylight）、seconds はゆらぎに使う時間（秒） */
    update(daylight, seconds) {
        const level = 1 - THREE.MathUtils.smoothstep(daylight, ON_DARK, OFF_BRIGHT);
        if (level !== this.level) {
            this.level = level;
            glassMaterial.emissiveIntensity = level * GLASS_GLOW;
            // 消えている間は光を外す（光の数が減るぶん描くのが軽くなる）
            for (const lamp of this.lamps)
                lamp.light.visible = level > 0;
        }
        if (level <= 0)
            return;
        for (const { light, intensity, phase } of this.lamps) {
            const flicker = 1 + FLICKER * (Math.sin(seconds * 9 + phase) * 0.6 + Math.sin(seconds * 23.3 + phase * 2.1) * 0.4);
            light.intensity = intensity * level * flicker;
        }
    }
}
