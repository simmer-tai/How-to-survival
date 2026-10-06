import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { terrainHeight, isGrassAt, valueNoise } from './terrain.js';
import type { Platform } from './props.js';
import { WIND_GLSL, windUniforms } from './wind.js';

const AREA = 70; // 島の中心からこの範囲に生やす
const SPACING = 0.42; // 房どうしの間隔（ずらして置く）
const BLADE_HEIGHT = 0.5;
const BLADE_WIDTH = 0.11;
const HIDDEN_Y = -1000; // 隠した房を移す高さ
const CHUNK_SIZE = 12; // 房をまとめて描く区画の一辺（m）。区画ごとに画面外・遠くなら描かない
const FADE_START = 45; // カメラからこの距離より遠い房は、だんだん縮めて消す
const DRAW_DISTANCE = 70; // この距離より遠い房は描かない
const SWAY_MARGIN = 0.6; // 風で揺れてはみ出す分、区画の境界球を広げる量
const GRASS_SWAY_CALM = 0.08; // 風がないときに、草の先がなびく量
const GRASS_SWAY_WIND = 0.4; // いちばん強い風のときに、草の先がなびく量へ足す分

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 細い三角形の葉を3枚、外側へ少し倒して束ねた房 */
function tuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  // 根元は地面と同じ色にして溶け込ませ、先端は明るくする
  const base = new THREE.Color(PALETTE.grass);
  const tip = new THREE.Color(PALETTE.grass).lerp(new THREE.Color(PALETTE.sand), 0.35);
  const blades = [
    { angle: 0, lean: 0.12, h: 1 },
    { angle: 2.2, lean: 0.2, h: 0.8 },
    { angle: 4.2, lean: 0.17, h: 0.9 },
  ];
  for (const { angle, lean, h } of blades) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const off = 0.05; // 房の中心から少し離す
    const bx = c * off;
    const bz = s * off;
    const tx = bx + c * lean;
    const tz = bz + s * lean;
    // 葉の幅は外向き方向と直交させる
    const wx = -s * BLADE_WIDTH * 0.5;
    const wz = c * BLADE_WIDTH * 0.5;
    positions.push(bx - wx, 0, bz - wz, bx + wx, 0, bz + wz, tx, BLADE_HEIGHT * h, tz);
    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // 地面と同じ陰影になるよう法線はすべて真上にする
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return geo;
}

/** 区画ひとつ分の房 */
interface Chunk {
  mesh: THREE.InstancedMesh;
  /** 房ごとの本来の配置（隠した房を戻すため） */
  matrices: THREE.Matrix4[];
  /** 区画の境界球（ワールド座標） */
  sphere: THREE.Sphere;
}

/** 草地に房を敷き詰め、風でそよがせる。区画に分けて、画面外や遠くの区画は描かない */
export class Grass {
  /** 全区画をまとめたグループ（シーンに足す） */
  readonly mesh = new THREE.Group();
  /** 房を縮め始める距離と、消える距離 */
  private readonly fade = { value: new THREE.Vector2(FADE_START, DRAW_DISTANCE) };
  private readonly chunks: Chunk[] = [];

  constructor(rocks: THREE.Mesh[], platforms: Platform[]) {
    const rand = mulberry32(5150);
    const blocked = (x: number, z: number) =>
      rocks.some((r) => Math.hypot(r.position.x - x, r.position.z - z) < Math.max(r.scale.x, r.scale.z) * 0.9) ||
      platforms.some((p) => x >= p.minX - 0.3 && x <= p.maxX + 0.3 && z >= p.minZ - 0.3 && z <= p.maxZ + 0.3);

    // 区画の番号ごとに房を集める
    const cells = new Map<string, { matrices: THREE.Matrix4[]; tints: THREE.Color[] }>();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const leaf = new THREE.Color(PALETTE.leaf);
    for (let gz = -AREA; gz < AREA; gz += SPACING) {
      for (let gx = -AREA; gx < AREA; gx += SPACING) {
        const x = gx + (rand() - 0.5) * SPACING;
        const z = gz + (rand() - 0.5) * SPACING;
        // ノイズで濃いところと薄いところを作る
        const patch = valueNoise(x * 0.12 + 7, z * 0.12 - 3);
        if (rand() > 0.55 + patch * 0.45) continue;
        if (!isGrassAt(x, z, 0.12) || blocked(x, z)) continue;
        const s = (0.65 + rand() * 0.55) * (1 + Math.max(patch, 0) * 0.5);
        pos.set(x, terrainHeight(x, z) - 0.03, z);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI * 2);
        scale.set(s, s * (0.8 + rand() * 0.5), s);
        const key = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
        let cell = cells.get(key);
        if (!cell) cells.set(key, (cell = { matrices: [], tints: [] }));
        cell.matrices.push(m.compose(pos, q, scale).clone());
        // 房ごとに少しだけ色をばらつかせる
        cell.tints.push(new THREE.Color(1, 1, 1).lerp(leaf, rand() * 0.25).multiplyScalar(0.94 + rand() * 0.1));
      }
    }

    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, windUniforms);
      shader.uniforms.uFade = this.fade;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform vec2 uFade;\n${WIND_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          // 風：先端ほど大きく、場所ごとに時間差のある突風で揺らす。風が強いほど大きくなびく
          vec2 rootPos = instanceMatrix[3].xz;
          float gust = sin(dot(rootPos, vec2(0.18, 0.11)) - uWindTime * 1.6) * 0.5 + 0.5;
          float flutter = sin(dot(rootPos, vec2(1.7, -1.3)) + uWindTime * 4.0);
          float bend = position.y / ${BLADE_HEIGHT.toFixed(2)};
          float lean = gust * (${GRASS_SWAY_CALM.toFixed(2)} + ${GRASS_SWAY_WIND.toFixed(2)} * uWind) + flutter * (0.015 + 0.075 * uWind);
          vec3 sway = vec3(uWindDir.x, 0.0, uWindDir.y) * lean * bend * bend;
          // 房は Y 軸回転と拡大だけなので、逆行列の代わりに転置 / 拡大率² でローカルへ戻す
          mat3 inst = mat3(instanceMatrix);
          transformed += transpose(inst) * sway / dot(inst[0], inst[0]);
          // 遠くの房は根元へ縮めて消す（区画ごと消したときに途切れて見えないように）
          transformed *= 1.0 - smoothstep(uFade.x, uFade.y, distance(rootPos, cameraPosition.xz));`,
        );
      // 裏面でも法線を反転させない（地面と同じ明るさにそろえる）
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize(vNormal);',
      );
    };

    const geometry = tuftGeometry();
    for (const { matrices, tints } of cells.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat));
      tints.forEach((c, i) => mesh.setColorAt(i, c));
      mesh.receiveShadow = true; // 木の影は落ちるが、草自体の影は細かすぎるので落とさない
      mesh.computeBoundingSphere();
      mesh.boundingSphere!.radius += SWAY_MARGIN;
      this.mesh.add(mesh);
      this.chunks.push({ mesh, matrices, sphere: mesh.boundingSphere!.clone() });
    }
  }

  /** covered(x, y, z) が true を返す根元の房を隠す（建てた床などの下から生えないように）。それ以外は元に戻す */
  setCovered(covered: (x: number, y: number, z: number) => boolean): void {
    const hidden = new THREE.Matrix4();
    for (const { mesh, matrices } of this.chunks) {
      matrices.forEach((m, i) => {
        const e = m.elements;
        if (!covered(e[12], e[13], e[14])) {
          mesh.setMatrixAt(i, m);
          return;
        }
        // 大きさ 0 にすると風の計算で 0 で割ってしまうので、地下深くへ移して隠す
        hidden.copy(m).elements[13] = HIDDEN_Y;
        mesh.setMatrixAt(i, hidden);
      });
      // 境界球は作り直さない（地下へ移した房で広がって、画面外判定が効かなくならないように）
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** viewDistance は見えている距離（水中では霧で狭まる）。それより遠くの房は描かない */
  update(camera: THREE.Vector3, viewDistance = Infinity): void {
    const end = Math.min(DRAW_DISTANCE, viewDistance);
    this.fade.value.set(Math.min(FADE_START, end * 0.7), end);
    for (const { mesh, sphere } of this.chunks) {
      const d = Math.hypot(sphere.center.x - camera.x, sphere.center.z - camera.z) - sphere.radius;
      mesh.visible = d < end;
    }
  }
}
