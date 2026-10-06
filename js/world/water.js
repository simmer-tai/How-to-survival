import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { WORLD_SIZE, SEA_FLOOR, terrainHeight } from './terrain.js';
import { WATER_LEVEL } from '../core/physics.js';
import { WAVE_GLSL, WAVE_FADE_END, waveScale } from '../core/waves.js';
const SEA_SIZE = 1200;
const SEGMENTS = 300; // 1辺の分割数
const DENSE_SEGMENTS = 110; // 中心から片側で細かく分割する数（残りは遠くへ引き伸ばす）
const DENSE_HALF = WAVE_FADE_END + 5;
const DEPTH_RES = 256;
const DEPTH_MAX = 4;
/** 海底の高さ height を焼き込んだテクスチャ（浅瀬の色と波打ち際の泡に使う）。場所ごとに作る */
export function bakeSeabed(height = terrainHeight) {
    const data = new Uint8Array(DEPTH_RES * DEPTH_RES);
    for (let j = 0; j < DEPTH_RES; j++) {
        for (let i = 0; i < DEPTH_RES; i++) {
            const x = ((i + 0.5) / DEPTH_RES - 0.5) * WORLD_SIZE;
            const z = ((j + 0.5) / DEPTH_RES - 0.5) * WORLD_SIZE;
            const k = (height(x, z) - SEA_FLOOR) / (DEPTH_MAX - SEA_FLOOR);
            data[j * DEPTH_RES + i] = Math.round(THREE.MathUtils.clamp(k, 0, 1) * 255);
        }
    }
    const tex = new THREE.DataTexture(data, DEPTH_RES, DEPTH_RES, THREE.RedFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}
/** 中心付近は細かく、遠くは粗いグリッド（XZ平面） */
function seaGeometry() {
    const geo = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const dense = DENSE_SEGMENTS / (SEGMENTS / 2);
    const stretch = (u) => {
        const s = Math.abs(u);
        const d = s <= dense ? (s / dense) * DENSE_HALF : DENSE_HALF + ((s - dense) / (1 - dense)) * (SEA_SIZE / 2 - DENSE_HALF);
        return Math.sign(u) * d;
    };
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
        pos.setX(i, stretch(pos.getX(i)));
        pos.setZ(i, stretch(pos.getZ(i)));
    }
    geo.computeBoundingSphere();
    return geo;
}
export class Sea {
    mesh;
    time = { value: 0 };
    /** 空の明るさ（0 が夜、1 が昼）。水中から見上げた水面の明るさに使う */
    daylight = { value: 1 };
    /** 今いる場所の海底の高さ */
    seabed = { value: bakeSeabed() };
    constructor() {
        const material = new THREE.MeshLambertMaterial({
            color: PALETTE.water,
            flatShading: true,
            transparent: true,
            opacity: 0.82,
            side: THREE.DoubleSide, // 潜ったときに水面を下から見られるように
            // 半透明の両面は、ふつう裏と表を2回に分けて描く。海は細かくて画面いっぱいに広がり重いので1回で描く
            // （波が重なって見えることはほとんどないので、描く順の乱れは目立たない）
            forceSinglePass: true,
        });
        const uniforms = {
            uTime: this.time,
            uWaveScale: waveScale,
            uDaylight: this.daylight,
            uSeabed: this.seabed,
            uShallow: { value: new THREE.Color(PALETTE.sky) },
            uFoam: { value: new THREE.Color(PALETTE.sky).lerp(new THREE.Color(PALETTE.sand), 0.15) },
        };
        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, uniforms);
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vSeaPos;\n${WAVE_GLSL}`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 seaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          transformed.y += waveOffset(seaWorld.xz, uTime);
          vSeaPos = vec3(seaWorld.x, ${WATER_LEVEL.toFixed(2)} + transformed.y, seaWorld.z);`);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform float uDaylight;
          uniform sampler2D uSeabed;
          uniform vec3 uShallow;
          uniform vec3 uFoam;
          varying vec3 vSeaPos;`)
                .replace('#include <normal_fragment_begin>', 
            // 波の面ごとにパキッと陰影をつける（フラットシェーディング）
            `#include <normal_fragment_begin>
          normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
          // 波の傾きが見えやすいよう、面の向きで明暗を段階的に上乗せする
          vec3 seaNormal = inverseTransformDirection(normal, viewMatrix);
          if (seaNormal.y < 0.0) seaNormal = -seaNormal; // 下から見たとき
          float tilt = dot(seaNormal.xz, vec2(0.6, 0.4)) * 6.0;
          diffuseColor.rgb *= 1.0 + floor(clamp(tilt, -1.0, 1.0) * 2.0 + 0.5) * 0.06 * (1.0 - foam);`)
                .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 seabedUv = vSeaPos.xz / ${WORLD_SIZE.toFixed(1)} + 0.5;
          float seabed = ${SEA_FLOOR.toFixed(1)} + texture2D(uSeabed, seabedUv).r * ${(DEPTH_MAX - SEA_FLOOR).toFixed(1)};
          float depth = vSeaPos.y - seabed;
          // 浅いところは明るく透ける（段階的に変えてトゥーンらしく）
          float shallow = 1.0 - smoothstep(0.0, 3.5, depth);
          shallow = floor(shallow * 3.0 + 0.5) / 3.0;
          diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, shallow * 0.45);
          diffuseColor.a = mix(diffuseColor.a, diffuseColor.a * 0.7, shallow);
          // 波打ち際の泡：岸に貼りつく泡と、沖から寄せてくる泡の線
          float edge = 1.0 - step(0.22, depth);
          float near = 1.0 - smoothstep(0.3, 1.8, depth);
          float wash = step(0.8, fract(depth * 0.8 + uTime * 0.45)) * near;
          // 波の山に少しだけ白波
          float crest = step(0.34, vSeaPos.y - ${WATER_LEVEL.toFixed(2)});
          float foam = max(max(edge, wash), crest * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, foam);
          diffuseColor.a = mix(diffuseColor.a, 0.95, foam);`)
                .replace('#include <opaque_fragment>', 
            // 水中から見上げた水面：日光が透けて明るく光る面にする（影・泡・陰影は付けない）
            `if (!gl_FrontFacing) {
            float lift = floor(clamp(tilt, -1.0, 1.0) * 2.0 + 0.5) * 0.07;
            outgoingLight = uShallow * (1.05 + lift) * uDaylight;
            diffuseColor.a = 0.92;
          }
          #include <opaque_fragment>`);
        };
        this.mesh = new THREE.Mesh(seaGeometry(), material);
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false;
    }
    update(t) {
        this.time.value = t;
    }
    setDaylight(k) {
        this.daylight.value = k;
    }
    /** 別の場所へ移ったときに、その場所の海底（bakeSeabed で作ったもの）にする */
    setSeabed(tex) {
        this.seabed.value = tex;
    }
}
