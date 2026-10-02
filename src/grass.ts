import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { terrainHeight, isGrassAt, valueNoise } from './terrain.js';
import type { Platform } from './props.js';

const AREA = 70; // 島の中心からこの範囲に生やす
const SPACING = 0.42; // 房どうしの間隔（ずらして置く）
const BLADE_HEIGHT = 0.5;
const BLADE_WIDTH = 0.11;

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

/** 草地に房を敷き詰め、風でそよがせる */
export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private readonly time = { value: 0 };

  constructor(gradientMap: THREE.Texture, rocks: THREE.Mesh[], platforms: Platform[]) {
    const rand = mulberry32(5150);
    const blocked = (x: number, z: number) =>
      rocks.some((r) => Math.hypot(r.position.x - x, r.position.z - z) < Math.max(r.scale.x, r.scale.z) * 0.9) ||
      platforms.some((p) => x >= p.minX - 0.3 && x <= p.maxX + 0.3 && z >= p.minZ - 0.3 && z <= p.maxZ + 0.3);

    const matrices: THREE.Matrix4[] = [];
    const tints: THREE.Color[] = [];
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
        matrices.push(m.compose(pos, q, scale).clone());
        // 房ごとに少しだけ色をばらつかせる
        tints.push(new THREE.Color(1, 1, 1).lerp(leaf, rand() * 0.25).multiplyScalar(0.94 + rand() * 0.1));
      }
    }

    const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          // 風：先端ほど大きく、場所ごとに時間差のある突風で揺らす
          vec2 rootPos = instanceMatrix[3].xz;
          float gust = sin(dot(rootPos, vec2(0.18, 0.11)) - uTime * 1.6) * 0.5 + 0.5;
          float flutter = sin(dot(rootPos, vec2(1.7, -1.3)) + uTime * 4.0);
          float bend = position.y / ${BLADE_HEIGHT.toFixed(2)};
          vec3 sway = vec3(0.7, 0.0, 0.45) * (gust * 0.16 + flutter * 0.03) * bend * bend;
          // 房は Y 軸回転と拡大だけなので、逆行列の代わりに転置 / 拡大率² でローカルへ戻す
          mat3 inst = mat3(instanceMatrix);
          transformed += transpose(inst) * sway / dot(inst[0], inst[0]);`,
        );
      // 裏面でも法線を反転させない（地面と同じ明るさにそろえる）
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize(vNormal);',
      );
    };

    this.mesh = new THREE.InstancedMesh(tuftGeometry(), material, matrices.length);
    matrices.forEach((mat, i) => this.mesh.setMatrixAt(i, mat));
    tints.forEach((c, i) => this.mesh.setColorAt(i, c));
    this.mesh.receiveShadow = true; // 木の影は落ちるが、草自体の影は細かすぎるので落とさない
    this.mesh.computeBoundingSphere();
  }

  update(t: number): void {
    this.time.value = t;
  }
}
