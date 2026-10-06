import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';

// 雨（自分の画面だけの演出）。カメラの周りの箱の中に細い線を降らせ、箱からはみ出した粒は反対側へ回して使い回す。
// 粒の動きはシェーダーで計算する。地面や水面には、落ちた所に広がって消える小さな輪（しぶき）を出す。
// 屋根などの下に雨が降りこまないよう、カメラの周りを真上から見下ろした「いちばん上にある物の高さ」を
// ときどきテクスチャに描いておき（遮る物の地図）、雨粒はその高さより下へ来たら消す

const DROP_COUNT = 9000; // 雨がいちばん強いときの粒の数
const AREA = 24; // カメラから水平にこの範囲（半径）に降らせる
const HEIGHT = 18; // 降らせる箱の高さ
const BELOW = 5; // 箱の底をカメラからどれだけ下にするか
const FALL_SPEED = 13; // 落ちる速さ（m/秒。粒ごとに少しばらつかせる）
const STREAK = 0.55; // 雨粒の線の長さ（粒ごとに少しばらつかせる）
const WIND = 0.3; // 落ちる 1m あたりに横へ流れる量（強い雨ほど斜めになる）
const OPACITY = 0.8;
const NEAR_FADE = 1.2; // カメラからこの距離より近い粒は薄くする（目の前を太い線が横切らないように）
const SEED = 9137; // 粒の配置を決める固定シード（演出なので何でもよい）

const SPLASH_COUNT = 360; // 雨がいちばん強いときに同時に出ている、しぶきの輪の数
const SPLASH_AREA = 12; // カメラから水平にこの範囲にしぶきを出す
const SPLASH_LIFE = 0.3; // しぶきの輪が広がって消えるまでの時間（秒）
const SPLASH_SIZE = 0.17; // しぶきの輪が広がりきったときの半径
const SPLASH_OPACITY = 0.22; // しぶきの輪の濃さ（目立ちすぎないよう雨粒より薄く）

const OCCLUDE_SIZE = 256; // 遮る物の地図の解像度（AREA の倍の幅をこのマス数で描く）
const OCCLUDE_ABOVE = 40; // 遮る物の地図を、カメラのどれだけ上から見下ろして描くか
const OCCLUDE_DEPTH = 60; // 見下ろす範囲の深さ（カメラの下 OCCLUDE_DEPTH - OCCLUDE_ABOVE まで）
const OCCLUDE_INTERVAL = 3; // 遮る物の地図を何フレームに1回描き直すか

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 雨粒の線 */
function buildDrops(uniforms: Record<string, THREE.IUniform>): THREE.LineSegments {
  const rand = mulberry32(SEED);
  const seeds = new Float32Array(DROP_COUNT * 2 * 4);
  const vary = new Float32Array(DROP_COUNT * 2 * 3);
  const ends = new Float32Array(DROP_COUNT * 2);
  for (let i = 0; i < DROP_COUNT; i++) {
    // 線の頭と しっぽ で同じ粒の値を持つ（x, y, z は箱の中の最初の位置、w は粒の番号 0〜1）
    const drop = [rand() * AREA * 2, rand() * HEIGHT, rand() * AREA * 2, i / DROP_COUNT];
    // 落ちる速さ・線の長さ・濃さの倍率（大粒ほど速く、長く、濃い）
    const big = rand();
    const v = [0.8 + big * 0.4, 0.6 + big * 0.7, 0.5 + rand() * 0.5];
    for (let e = 0; e < 2; e++) {
      seeds.set(drop, (i * 2 + e) * 4);
      vary.set(v, (i * 2 + e) * 3);
    }
    ends[i * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DROP_COUNT * 2 * 3), 3));
  geo.setAttribute('aDrop', new THREE.Float32BufferAttribute(seeds, 4));
  geo.setAttribute('aVary', new THREE.Float32BufferAttribute(vary, 3));
  geo.setAttribute('aEnd', new THREE.Float32BufferAttribute(ends, 1));

  const material = new THREE.LineBasicMaterial({ color: PALETTE.sky, transparent: true, opacity: OPACITY, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uCenter;
        uniform float uAmount;
        uniform sampler2D uOccMap;
        uniform mat4 uOccMatrix;
        uniform vec2 uOccRange;
        attribute vec4 aDrop;
        attribute vec3 aVary;
        attribute float aEnd;
        varying float vFade;`,
      )
      .replace('#include <common>', '#include <common>\n#include <packing>')
      .replace(
        '#include <begin_vertex>',
        `// 箱の中で落とし、カメラが動いても箱の外へ出た粒は反対側から入れ直す
        float wind = ${WIND.toFixed(2)} * uAmount;
        vec2 windDir = vec2(0.8, 0.6) * wind;
        float fallen = uTime * ${FALL_SPEED.toFixed(1)} * aVary.x;
        float y = mod(aDrop.y - fallen, ${HEIGHT.toFixed(1)});
        // 風下へ流す量は、箱の上から落ちてきたぶんだけにする（経過時間を掛けると、雨の強さ＝風の強さが変わったときに粒が横へ飛ぶ）
        vec2 xz = mod(aDrop.xz + windDir * (${HEIGHT.toFixed(1)} - y) - uCenter.xz +${AREA.toFixed(1)}, ${(AREA * 2).toFixed(1)}) - ${AREA.toFixed(1)};
        vec3 transformed = vec3(uCenter.x + xz.x, uCenter.y - ${BELOW.toFixed(1)} + y, uCenter.z + xz.y);
        // 遮る物（屋根・地面など）より下に来た粒は描かない。線の頭で決めて、頭としっぽをそろえて消す
        vec4 occClip = uOccMatrix * vec4(transformed, 1.0);
        vec2 occUv = occClip.xy * 0.5 + 0.5;
        bool covered = false;
        if (uOccRange.y > 0.0 && occUv.x > 0.0 && occUv.x < 1.0 && occUv.y > 0.0 && occUv.y < 1.0) {
          float depth = unpackRGBAToDepth(texture2D(uOccMap, occUv));
          covered = depth < 0.999 && transformed.y < uOccRange.x - depth * uOccRange.y - 0.05;
        }
        // しっぽは、落ちてきた向きの逆（上・風上）へ伸ばす
        transformed += vec3(-windDir.x, 1.0, -windDir.y) * ${STREAK.toFixed(2)} * aVary.y * aEnd;
        // 濃さ：しっぽは透かし、箱の端（水平・上下）とカメラのすぐ近くでは薄くして、出入りを目立たせない
        float edge = 1.0 - smoothstep(${(AREA * 0.55).toFixed(1)}, ${AREA.toFixed(1)}, length(xz));
        float band = smoothstep(0.0, 2.0, y) * (1.0 - smoothstep(${(HEIGHT - 3).toFixed(1)}, ${HEIGHT.toFixed(1)}, y));
        float near = smoothstep(0.3, ${NEAR_FADE.toFixed(1)}, distance(transformed, cameraPosition));
        vFade = aVary.z * (1.0 - aEnd * 0.7) * edge * band * near;
        // 弱い雨では粒を減らす。描かない粒は箱の下へ畳む
        if (aDrop.w > uAmount || covered) transformed = vec3(uCenter.x, uCenter.y - 1000.0, uCenter.z);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFade;');
  };

  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false; // 位置はシェーダーで決めるので、境界球で画面外判定をしない
  lines.renderOrder = 1;
  return lines;
}

/** 地面・水面に落ちた雨のしぶき（広がって消える平たい輪）。輪ごとの年齢（0〜1）で広げて薄くする */
class Splashes {
  readonly mesh: THREE.InstancedMesh;
  private readonly age = new Float32Array(SPLASH_COUNT);
  private readonly ageAttr: THREE.InstancedBufferAttribute;
  private readonly pos = Array.from({ length: SPLASH_COUNT }, () => new THREE.Vector3());
  private readonly m = new THREE.Matrix4();

  constructor() {
    const geo = new THREE.RingGeometry(0.86, 1, 14, 1);
    geo.rotateX(-Math.PI / 2);
    this.ageAttr = new THREE.InstancedBufferAttribute(this.age, 1);
    geo.setAttribute('aAge', this.ageAttr);
    const material = new THREE.MeshBasicMaterial({ color: PALETTE.sky, transparent: true, opacity: SPLASH_OPACITY, depthWrite: false });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAge;\nvarying float vAge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAge = aAge;\ntransformed *= 0.15 + 0.85 * sqrt(aAge);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAge;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= (1.0 - vAge) * (1.0 - vAge);');
    };
    this.mesh = new THREE.InstancedMesh(geo, material, SPLASH_COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    // 最初は年齢をばらけさせて、一斉に出ないようにする
    for (let i = 0; i < SPLASH_COUNT; i++) this.age[i] = Math.random();
  }

  /** surface(x, z) は雨が当たる面の高さ（屋根・地面・水面のいちばん上）。amount は雨の強さ */
  update(dt: number, center: THREE.Vector3, amount: number, surface: (x: number, z: number) => number): void {
    const active = Math.round(SPLASH_COUNT * amount);
    this.mesh.count = active;
    for (let i = 0; i < active; i++) {
      let a = this.age[i] + dt / SPLASH_LIFE;
      if (a >= 1) {
        // 次に落ちる所を選ぶ（しぶきは自分の画面だけの演出なので Math.random）
        const r = Math.sqrt(Math.random()) * SPLASH_AREA;
        const t = Math.random() * Math.PI * 2;
        const x = center.x + Math.cos(t) * r;
        const z = center.z + Math.sin(t) * r;
        this.pos[i].set(x, surface(x, z) + 0.03, z);
        a %= 1;
      }
      this.age[i] = a;
      const s = SPLASH_SIZE * (0.7 + (i % 5) * 0.12);
      this.m.makeScale(s, 1, s).setPosition(this.pos[i]);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.ageAttr.needsUpdate = true;
  }
}

export class Rain {
  /** 雨粒としぶき（シーンに足す） */
  readonly object = new THREE.Group();
  private readonly drops: THREE.LineSegments;
  private readonly splashes = new Splashes();
  private readonly uniforms = {
    uTime: { value: 0 },
    /** 降らせる箱の中心（カメラの位置） */
    uCenter: { value: new THREE.Vector3() },
    /** 雨の強さ（0〜1）。粒の番号がこれより大きい粒は描かない */
    uAmount: { value: 0 },
    /** 遮る物の地図（真上から見下ろした深さ） */
    uOccMap: { value: null as THREE.Texture | null },
    /** 世界の位置 → 遮る物の地図のクリップ座標 */
    uOccMatrix: { value: new THREE.Matrix4() },
    /** 地図を描いたカメラの高さと、見下ろす深さ（深さが 0 なら、まだ地図がない） */
    uOccRange: { value: new THREE.Vector2() },
  };
  private readonly occTarget = new THREE.WebGLRenderTarget(OCCLUDE_SIZE, OCCLUDE_SIZE);
  private readonly occCamera = new THREE.OrthographicCamera(-AREA, AREA, AREA, -AREA, 0, OCCLUDE_DEPTH);
  private readonly occMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  private occFrame = 0;
  private readonly clearColor = new THREE.Color();

  constructor() {
    this.drops = buildDrops(this.uniforms);
    this.object.add(this.drops, this.splashes.mesh);
    this.object.visible = false;
    this.uniforms.uOccMap.value = this.occTarget.texture;
    this.occCamera.up.set(0, 0, -1); // 地図の上を北（-Z）にする
  }

  /**
   * 遮る物の地図を描く（雨が降っている間だけ、何フレームかに1回）。
   * hidden は地図に入れない物（空・草など。雨そのものは自分で外す）。シーンのレイヤー 0 に見えている物が雨を遮る
   */
  renderOcclusion(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hidden: THREE.Object3D[]): void {
    if (!this.object.visible || this.occFrame++ % OCCLUDE_INTERVAL !== 0) return;
    const c = this.uniforms.uCenter.value;
    this.occCamera.position.set(c.x, c.y + OCCLUDE_ABOVE, c.z);
    this.occCamera.lookAt(c.x, c.y, c.z);
    this.occCamera.updateMatrixWorld();

    const shown = [this.object, ...hidden].map((o) => o.visible);
    for (const o of [this.object, ...hidden]) o.visible = false;
    const { background, overrideMaterial } = scene;
    const shadows = renderer.shadowMap.needsUpdate;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    scene.background = null;
    scene.overrideMaterial = this.occMaterial;
    renderer.shadowMap.needsUpdate = false;
    renderer.setClearColor(0xffffff, 1); // 何もない所は いちばん奥（深さ 1）
    renderer.setRenderTarget(this.occTarget);
    renderer.clear();
    renderer.render(scene, this.occCamera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(this.clearColor, alpha);
    renderer.shadowMap.needsUpdate = shadows;
    scene.background = background;
    scene.overrideMaterial = overrideMaterial;
    [this.object, ...hidden].forEach((o, i) => (o.visible = shown[i]));

    this.uniforms.uOccMatrix.value.multiplyMatrices(this.occCamera.projectionMatrix, this.occCamera.matrixWorldInverse);
    this.uniforms.uOccRange.value.set(this.occCamera.position.y, OCCLUDE_DEPTH);
  }

  /**
   * amount は雨の強さ（0〜1）。color は雨の色（空の明るさに合わせ、夜に白く光って見えないようにする）。
   * surface は雨が当たる面の高さ（しぶきを出す所）
   */
  update(
    t: number,
    dt: number,
    center: THREE.Vector3,
    amount: number,
    color: THREE.Color,
    surface: (x: number, z: number) => number,
  ): void {
    this.object.visible = amount > 0.01;
    if (!this.object.visible) return;
    this.uniforms.uTime.value = t;
    this.uniforms.uCenter.value.copy(center);
    this.uniforms.uAmount.value = amount;
    (this.drops.material as THREE.LineBasicMaterial).color.copy(color);
    (this.splashes.mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    this.splashes.update(dt, center, amount, surface);
  }
}
