import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { WORLD_SIZE, SEA_FLOOR, terrainHeight } from './terrain.js';
import { WATER_LEVEL } from '../core/physics.js';
import { WAVE_GLSL, waveScale } from '../core/waves.js';
const SEA_SIZE = 1200;
const SEGMENTS = 300; // 1辺の分割数
const NEAR_CELL = 2.5; // 中心のマスの一辺（m）。遠くほどマスを大きくして、遠くの波も大きな面で描く
const DEEP_SHADE = 1; // 沖の水の色（PALETTE.sea）の明るさの倍率
const REFLECT = 0.5; // 空を映す強さ。水面を浅い角度で見る面ほど空の色になる（フレネル）
const REFLECT_POWER = 4; // 空を映す割合が、見る角度でどれだけ急に変わるか（大きいほど浅い角度だけ映る）
const DEPTH_RES = 256;
const DEPTH_MAX = 4;
const DRY = 255; // 海底のテクスチャの、海の水を描かない所の値（ほかの所は DRY - 1 まで）
// 水面のドット絵（木目と同じく、明るさだけの模様を掛ける）。四角いムラを、ドットの番号から決めた乱数で散らす
// （くり返しの模様が見えないように。番号から決めるので誰の画面でも同じ）。大・中・小のムラを重ね、横（x）に少し長い
const WATER_DOT = 0.6; // 1ドットの大きさ（m）
const WATER_DOT_STRETCH = 1.3; // ドットを横（x）に伸ばす割合
const WATER_BLOTCHES = [3, 2, 1]; // 重ねるムラの大きさ（ドット数）。大きい順に塗り、小さいムラが上に乗る
const WATER_BRIGHT = 1.08; // 明るいムラの明るさ（さざ波の光）
const WATER_DARK = 0.93; // 暗いムラの明るさ
const WATER_BRIGHT_RATE = 0.12; // ムラのうち明るくなる割合（大きさごと）
const WATER_DARK_RATE = 0.16; // ムラのうち暗くなる割合（大きさごと）
const WATER_DRIFT = [0.18, 0.07]; // 模様が流れる速さ（m／秒。x・z）
const WATER_DOT_FADE = 150; // カメラからこの距離（m）までに、模様をだんだん薄くして消す（遠くでちらつかないように）
/**
 * 海底の高さ height を焼き込んだテクスチャ（浅瀬の色と波打ち際の泡に使う）。場所ごとに作る。size は場所の広さ。
 * dry が true を返す所（洞窟の上）は DRY の値にして、海の水面を描かない（洞窟の上は陸なので、外からは変わらない）
 */
export function bakeSeabed(height = terrainHeight, size = WORLD_SIZE, dry) {
    const data = new Uint8Array(DEPTH_RES * DEPTH_RES);
    for (let j = 0; j < DEPTH_RES; j++) {
        for (let i = 0; i < DEPTH_RES; i++) {
            const x = ((i + 0.5) / DEPTH_RES - 0.5) * size;
            const z = ((j + 0.5) / DEPTH_RES - 0.5) * size;
            const h = height(x, z);
            const k = (h - SEA_FLOOR) / (DEPTH_MAX - SEA_FLOOR);
            data[j * DEPTH_RES + i] = dry?.(x, z) && h > WATER_LEVEL ? DRY : Math.round(THREE.MathUtils.clamp(k, 0, 1) * (DRY - 1));
        }
    }
    const tex = new THREE.DataTexture(data, DEPTH_RES, DEPTH_RES, THREE.RedFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    tex.userData.size = size;
    return tex;
}
/** 中心付近は細かく、遠くほど粗いグリッド（XZ平面） */
function seaGeometry() {
    const geo = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    // 中心からの距離 s（0〜1）を a·s + b·s³ に引き伸ばす：中心のマスは NEAR_CELL、外へいくほどなめらかに大きくなる
    const a = (NEAR_CELL * SEGMENTS) / 2;
    const b = SEA_SIZE / 2 - a;
    const stretch = (u) => {
        const s = Math.abs(u);
        return Math.sign(u) * (a * s + b * s * s * s);
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
    /** 海底のテクスチャがおおう広さ（m） */
    seabedSize = { value: WORLD_SIZE };
    /** 水面に映す空の色（地平線の色。霧と同じ色にして、遠くの海が空に溶けるようにする） */
    skyColor = { value: new THREE.Color(PALETTE.sky) };
    constructor() {
        const material = new THREE.MeshLambertMaterial({
            color: new THREE.Color(PALETTE.sea).multiplyScalar(DEEP_SHADE),
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
            uSeabedSize: this.seabedSize,
            uShallow: { value: new THREE.Color(PALETTE.sky) },
            uFoam: { value: new THREE.Color(PALETTE.sky).lerp(new THREE.Color(PALETTE.sand), 0.15) },
            uSkyColor: this.skyColor,
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
          uniform float uSeabedSize;
          uniform vec3 uShallow;
          uniform vec3 uFoam;
          uniform vec3 uSkyColor;
          // ドットの番号から 0〜1 の乱数（誰の画面でも同じ）
          float seaHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
          varying vec3 vSeaPos;`)
                .replace('#include <normal_fragment_begin>', 
            // 波の面ごとにパキッと陰影をつける（フラットシェーディング）
            `#include <normal_fragment_begin>
          normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
          // 波の傾きが見えやすいよう、面の向きで明暗を段階的に上乗せする
          vec3 seaNormal = inverseTransformDirection(normal, viewMatrix);
          if (seaNormal.y < 0.0) seaNormal = -seaNormal; // 下から見たとき
          float tilt = dot(seaNormal.xz, vec2(0.6, 0.4)) * 6.0;
          // 面ごとの空の映り込み（フレネル）。面の向きと見る向きで決まるので、波の面が一枚ずつ明暗に分かれる
          vec3 seaView = normalize(vViewPosition);
          float seaFacing = abs(dot(normal, seaView));
          float seaReflect = pow(1.0 - seaFacing, ${REFLECT_POWER.toFixed(1)}) * ${REFLECT.toFixed(2)};
`)
                .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 seabedUv = vSeaPos.xz / uSeabedSize + 0.5;
          float seabedK = texture2D(uSeabed, seabedUv).r;
          if (seabedK > ${((DRY - 0.5) / 255).toFixed(5)}) discard; // 洞窟の中には海の水を描かない
          float seabed = ${SEA_FLOOR.toFixed(1)} + min(seabedK * ${(255 / (DRY - 1)).toFixed(5)}, 1.0) * ${(DEPTH_MAX - SEA_FLOOR).toFixed(1)};
          float depth = vSeaPos.y - seabed;
          // 浅いところは明るく透ける（段階的に変えてトゥーンらしく）
          float shallow = 1.0 - smoothstep(0.0, 3.5, depth);
          shallow = floor(shallow * 3.0 + 0.5) / 3.0;
          diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, shallow * 0.45);
          diffuseColor.a = mix(diffuseColor.a, diffuseColor.a * 0.7, shallow);
          // 水面のドット絵：ゆっくり流れる、乱数で散らした四角いムラ。遠くでは薄くして消す
          vec2 dotP = (vSeaPos.xz - vec2(${WATER_DRIFT[0].toFixed(3)}, ${WATER_DRIFT[1].toFixed(3)}) * uTime) / (${WATER_DOT.toFixed(2)} * vec2(${WATER_DOT_STRETCH.toFixed(2)}, 1.0));
          float dotShade = 1.0;
${WATER_BLOTCHES.map((n, k) => `          { float h = seaHash(floor((dotP + vec2(${(k * 1.7).toFixed(1)}, ${(k * 2.3).toFixed(1)})) / ${n.toFixed(1)}) + ${(k * 31).toFixed(1)});
            if (h < ${WATER_DARK_RATE.toFixed(3)}) dotShade = ${WATER_DARK.toFixed(3)};
            else if (h > ${(1 - WATER_BRIGHT_RATE).toFixed(3)}) dotShade = ${WATER_BRIGHT.toFixed(3)}; }`).join('\n')}
          float dotNear = 1.0 - smoothstep(${(WATER_DOT_FADE * 0.5).toFixed(1)}, ${WATER_DOT_FADE.toFixed(1)}, length(vViewPosition));
          float dotMul = mix(1.0, dotShade, dotNear);
          // 波打ち際の泡：岸に貼りつく泡と、沖から寄せてくる泡の線
          float edge = 1.0 - step(0.22, depth);
          float near = 1.0 - smoothstep(0.3, 1.8, depth);
          float wash = step(0.8, fract(depth * 0.8 + uTime * 0.45)) * near;
          float foam = max(edge, wash);
          diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, foam);
          diffuseColor.a = mix(diffuseColor.a, 0.95, foam);`)
                .replace('#include <opaque_fragment>', 
            // 水中から見上げた水面：日光が透けて明るく光る面にする（影・泡・陰影は付けない）
            `if (!gl_FrontFacing) {
            float lift = floor(clamp(tilt, -1.0, 1.0) * 2.0 + 0.5) * 0.07;
            outgoingLight = uShallow * (1.05 + lift) * uDaylight;
            diffuseColor.a = 0.92;
          } else {
            // 上から見た水面：空を映す（泡には映さない。空の色は時刻で暗くなっている）
            float clear = 1.0 - foam;
            outgoingLight = mix(outgoingLight, uSkyColor, seaReflect * clear);
            outgoingLight *= mix(1.0, dotMul, clear); // 映り込みの上からドット絵の明暗を掛ける
            diffuseColor.a = mix(diffuseColor.a, 1.0, seaReflect * clear);
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
    /** 水面に映す空の色（霧の色） */
    setSkyColor(color) {
        this.skyColor.value.copy(color);
    }
    /** 今の海底のテクスチャ */
    get seabedTexture() {
        return this.seabed.value;
    }
    /** 別の場所へ移ったときに、その場所の海底（bakeSeabed で作ったもの）にする */
    setSeabed(tex) {
        this.seabed.value = tex;
        this.seabedSize.value = tex.userData.size ?? WORLD_SIZE;
    }
}
