import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
// 時刻に合わせて空の色・太陽と月・星・光の向きと強さを変える（見た目だけ。時刻そのものは clock.ts）
const SUN_INTENSITY = 2.4; // 昼の太陽の光の強さ
const MOON_INTENSITY = 0.7; // 夜の月明かりの強さ（夜でも周りが見える程度）
const DAY_HEMI = 1.1; // 昼の空の光（半球光）の強さ
const NIGHT_HEMI = 0.6; // 夜の空の光の強さ
const NIGHT_SKY = 0.16; // 夜空の明るさ（海の色に掛ける）
const NIGHT_GROUND = 0.35; // 夜の地面からの照り返しの明るさ
const DUSK_TINT = 0.75; // 朝焼け・夕焼けで空を赤く染める強さ
const SUN_TILT = 0.45; // 太陽と月の通り道を南（+Z）へ傾ける量
const LIGHT_DISTANCE = 120; // 影を作る光を置く距離
const SKY_DISTANCE = 420; // 太陽・月・星を置く距離（カメラの far より手前）
const SUN_SIZE = 20; // 太陽の円盤の半径
const MOON_SIZE = 13; // 月の円盤の半径
const STAR_COUNT = 600;
const STAR_SEED = 4242; // 星の配置を決める固定シード
function mulberry32(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** 空に浮かぶ円盤（太陽・月）。霧に溶けないよう霧の影響を受けない */
function disc(radius, color) {
    const mat = new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 10), mat);
    mesh.renderOrder = -1; // 星より手前に描く
    return mesh;
}
/** 空いっぱいに散らした星（配置は固定シードなので誰の画面でも同じ） */
function starField() {
    const rand = mulberry32(STAR_SEED);
    const positions = [];
    for (let i = 0; i < STAR_COUNT; i++) {
        // 球面上に均等に散らす
        const y = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(1 - y * y);
        positions.push(Math.cos(a) * r * SKY_DISTANCE, y * SKY_DISTANCE, Math.sin(a) * r * SKY_DISTANCE);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        color: PALETTE.sky,
        size: 2,
        sizeAttenuation: false,
        fog: false,
        transparent: true,
        depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = -2;
    return points;
}
export class Sky {
    hemi;
    light;
    /** 今の空の色（背景と霧に使う） */
    color = new THREE.Color();
    /** 明るさ。0 が夜、1 が昼 */
    daylight = 1;
    /** カメラについて動く空（太陽・月・星） */
    dome = new THREE.Group();
    /** 時刻に合わせて回る天球。ローカルの (1, 0, SUN_TILT) に太陽、(-1, 0, SUN_TILT) に月がある */
    sphere = new THREE.Group();
    sun = disc(SUN_SIZE, PALETTE.sand);
    moon = disc(MOON_SIZE, PALETTE.sky);
    stars = starField();
    sunDir = new THREE.Vector3();
    daySky = new THREE.Color(PALETTE.sky);
    nightSky = new THREE.Color(PALETTE.water).multiplyScalar(NIGHT_SKY);
    /** 朝焼け・夕焼けの色（赤と砂色のあいだのオレンジ） */
    dusk = new THREE.Color(PALETTE.accent).lerp(new THREE.Color(PALETTE.sand), 0.35);
    sea = new THREE.Color(PALETTE.water);
    white = new THREE.Color(0xffffff);
    constructor(scene, hemi, light) {
        this.hemi = hemi;
        this.light = light;
        const along = new THREE.Vector3(1, 0, SUN_TILT).normalize().multiplyScalar(SKY_DISTANCE - 10);
        this.sun.position.copy(along);
        this.moon.position.set(-along.x, along.y, along.z);
        this.sphere.add(this.stars, this.sun, this.moon);
        this.dome.add(this.sphere);
        scene.add(this.dome);
    }
    /** 潜っているときは空を隠す */
    set visible(v) {
        this.dome.visible = v;
    }
    /** hour はその日の時刻（0〜24）。光・空の色・天球を更新する */
    update(hour, camera) {
        // 6時に東（+X）から昇り、12時に真上、18時に西へ沈む
        const a = ((hour - 6) / 24) * Math.PI * 2;
        this.sunDir.set(Math.cos(a), Math.sin(a), SUN_TILT).normalize();
        const e = this.sunDir.y; // 太陽の高さ（-1〜1）。月は反対側にあるので -e
        const day = THREE.MathUtils.smoothstep(e, -0.12, 0.18);
        const glow = 1 - THREE.MathUtils.smoothstep(Math.abs(e), 0, 0.35); // 日の出・日の入りのころほど 1
        this.daylight = day;
        // 空：夜は暗い紺、昼は空色。地平線に太陽があるころは赤く染める
        this.color.copy(this.nightSky).lerp(this.daySky, day).lerp(this.dusk, glow * DUSK_TINT * Math.max(day, 0.3));
        this.hemi.color.copy(this.nightSky).lerp(this.daySky, day).lerp(this.dusk, glow * 0.25);
        // 夜の空の光は海の色で青白く
        if (day < 1)
            this.hemi.color.lerp(this.sea, (1 - day) * 0.6);
        this.hemi.groundColor.set(PALETTE.grass).multiplyScalar(THREE.MathUtils.lerp(NIGHT_GROUND, 1, day));
        this.hemi.intensity = THREE.MathUtils.lerp(NIGHT_HEMI, DAY_HEMI, day);
        // 影を作る光：昼は太陽、夜は月（地平線をまたぐときはどちらも弱くなるので切り替わりは目立たない）
        if (e >= 0) {
            this.light.position.copy(this.sunDir).multiplyScalar(LIGHT_DISTANCE);
            this.light.color.copy(this.white).lerp(this.dusk, glow * 0.45);
            this.light.intensity = SUN_INTENSITY * THREE.MathUtils.smoothstep(e, 0, 0.15);
        }
        else {
            this.light.position.set(-this.sunDir.x, -this.sunDir.y, this.sunDir.z).multiplyScalar(LIGHT_DISTANCE);
            this.light.color.set(PALETTE.sky);
            this.light.intensity = MOON_INTENSITY * THREE.MathUtils.smoothstep(-e, 0, 0.15);
        }
        // 天球：カメラについていき、時刻のぶん回す
        this.dome.position.copy(camera.position);
        this.sphere.rotation.z = a;
        this.dome.updateMatrixWorld(true);
        this.sun.lookAt(camera.position);
        this.moon.lookAt(camera.position);
        this.sun.material.color.set(PALETTE.sand).lerp(this.dusk, glow * 0.6);
        this.sun.material.opacity = THREE.MathUtils.smoothstep(e, -0.06, 0.04); // 沈んだら海越しに透けて見えないように消す
        this.moon.material.opacity = THREE.MathUtils.smoothstep(-e, -0.06, 0.04);
        this.stars.material.opacity = 1 - THREE.MathUtils.smoothstep(day, 0.05, 0.6);
        this.stars.visible = this.stars.material.opacity > 0;
    }
}
