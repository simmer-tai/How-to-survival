import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import type { Weather } from './weather.js';

// 時刻と天気に合わせて空の色・太陽と月・星・雲・光の向きと強さを変える（見た目だけ。時刻そのものは clock.ts、天気は weather.ts）

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
const CLOUD_COUNT = 40; // 空に浮かべる雲の数（雲の多さに合わせて、このうちの何個かを出す）
const CLOUD_SEED = 2718; // 雲の配置を決める固定シード
const CLOUD_DRIFT = 0.0004; // 雲が流れる速さ（ゲーム内の 1分あたりに回る角度。時刻から決めるので誰の画面でも同じ）
const OVERCAST_TINT = 0.8; // 曇りの空を灰色に染める強さ
const OVERCAST_SUN = 0.75; // 曇りで日差し（月明かり）を弱める割合
const OVERCAST_HEMI = 0.2; // 曇りで空の光を弱める割合
const LIGHTNING_INTERVAL = 9; // 嵐のとき、雷が光るまでの平均の間隔（秒）
const LIGHTNING_HEMI = 2.5; // 雷が光った瞬間に空の光へ足す強さ
const STORM_DARK = 0.3; // 嵐の空をさらに暗くする割合
const CLOUD_UNDERSIDE = 0.78; // 雲の下向きの面の明るさ（上向きの面を 1 とする）

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 空に浮かぶ円盤（太陽・月）。霧に溶けないよう霧の影響を受けない */
function disc(radius: number, color: number): THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> {
  const mat = new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 10), mat);
  mesh.renderOrder = -1; // 星より手前に描く
  return mesh;
}

/** 空いっぱいに散らした星（配置は固定シードなので誰の画面でも同じ） */
function starField(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const rand = mulberry32(STAR_SEED);
  const positions: number[] = [];
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

/** 空に浮かべる雲。平たくつぶした多面体を何個か寄せて1つの雲にし、全部の雲を1つのメッシュで描く */
interface Cloud {
  /** この雲を出す雲の多さ（雲の多さがこれを超えると出てくる） */
  need: number;
  puffs: THREE.Matrix4[];
}

function buildClouds(): { mesh: THREE.InstancedMesh; clouds: Cloud[] } {
  const rand = mulberry32(CLOUD_SEED);
  const clouds: Cloud[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const a = rand() * Math.PI * 2;
    const r = 130 + rand() * 190;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const cy = 75 + rand() * 45;
    const size = 9 + rand() * 9;
    const along = rand() * Math.PI; // 雲が横に長くのびる向き
    const puffs: THREE.Matrix4[] = [];
    const n = 3 + Math.floor(rand() * 4);
    for (let j = 0; j < n; j++) {
      const t = (j / (n - 1) - 0.5) * size * 2.2;
      p.set(cx + Math.cos(along) * t, cy + rand() * size * 0.3, cz + Math.sin(along) * t);
      const k = size * (1 - Math.abs(t) / (size * 2.2)) * (0.8 + rand() * 0.4);
      s.set(k * 1.3, k * 0.55, k);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI);
      puffs.push(m.compose(p, q, s).clone());
    }
    clouds.push({ need: rand(), puffs });
    total += n;
  }
  // 雲は光で照らさず（下から見ると地面の照り返しで緑がかってしまうので）、面の向きで明るさを焼き込む
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const normals = geo.getAttribute('normal');
  const shades: number[] = [];
  for (let i = 0; i < normals.count; i += 3) {
    const ny = (normals.getY(i) + normals.getY(i + 1) + normals.getY(i + 2)) / 3;
    const k = THREE.MathUtils.lerp(CLOUD_UNDERSIDE, 1, Math.round((ny * 0.5 + 0.5) * 3) / 3);
    for (let j = 0; j < 3; j++) shades.push(k, k, k);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
  const mat = new THREE.MeshBasicMaterial({ color: PALETTE.sky, vertexColors: true, fog: false }); // 色は Sky が時刻と天気に合わせて変える
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.frustumCulled = false;
  return { mesh, clouds };
}

export class Sky {
  /** 今の空の色（背景と霧に使う） */
  readonly color = new THREE.Color();
  /** 明るさ。0 が夜、1 が昼 */
  daylight = 1;
  /** カメラについて動く空（太陽・月・星） */
  private readonly dome = new THREE.Group();
  /** 時刻に合わせて回る天球。ローカルの (1, 0, SUN_TILT) に太陽、(-1, 0, SUN_TILT) に月がある */
  private readonly sphere = new THREE.Group();
  private readonly sun = disc(SUN_SIZE, PALETTE.sand);
  private readonly moon = disc(MOON_SIZE, PALETTE.sky);
  private readonly stars = starField();
  /** 雲（天球と一緒には回らず、時刻に合わせてゆっくり流れる） */
  private readonly cloudLayer = new THREE.Group();
  private readonly cloudMesh: THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  private readonly clouds: Cloud[];
  /** 雲のメッシュに今反映している雲の多さ */
  private shownCover = -1;
  /** 雷の光の強さ（光った瞬間が 1 で、すぐに消える） */
  private flash = 0;
  private readonly sunDir = new THREE.Vector3();

  private readonly daySky = new THREE.Color(PALETTE.sky);
  private readonly nightSky = new THREE.Color(PALETTE.water).multiplyScalar(NIGHT_SKY);
  /** 朝焼け・夕焼けの色（赤と砂色のあいだのオレンジ） */
  private readonly dusk = new THREE.Color(PALETTE.accent).lerp(new THREE.Color(PALETTE.sand), 0.35);
  private readonly sea = new THREE.Color(PALETTE.water);
  private readonly white = new THREE.Color(0xffffff);
  /** 雲が厚いときの空の色（明るさは時刻で変える） */
  private readonly overcast = new THREE.Color();
  private readonly cloudWhite = new THREE.Color(PALETTE.sky).lerp(this.white, 0.8);

  constructor(
    scene: THREE.Scene,
    private readonly hemi: THREE.HemisphereLight,
    private readonly light: THREE.DirectionalLight,
  ) {
    const along = new THREE.Vector3(1, 0, SUN_TILT).normalize().multiplyScalar(SKY_DISTANCE - 10);
    this.sun.position.copy(along);
    this.moon.position.set(-along.x, along.y, along.z);
    this.sphere.add(this.stars, this.sun, this.moon);
    const { mesh, clouds } = buildClouds();
    this.cloudMesh = mesh as typeof this.cloudMesh;
    this.clouds = clouds;
    this.cloudLayer.add(mesh);
    this.dome.add(this.sphere, this.cloudLayer);
    scene.add(this.dome);
  }

  /** 空（太陽・月・星・雲）をまとめたもの */
  get object(): THREE.Object3D {
    return this.dome;
  }

  /** 潜っているときは空を隠す */
  set visible(v: boolean) {
    this.dome.visible = v;
  }

  /** minutes はワールドの時刻（WorldClock.minutes）。光・空の色・天球・雲を、時刻と天気に合わせて更新する */
  update(minutes: number, weather: Weather, camera: THREE.Camera, dt: number): void {
    const hour = (minutes / 60) % 24;
    // 6時に東（+X）から昇り、12時に真上、18時に西へ沈む
    const a = ((hour - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a), SUN_TILT).normalize();
    const e = this.sunDir.y; // 太陽の高さ（-1〜1）。月は反対側にあるので -e
    const day = THREE.MathUtils.smoothstep(e, -0.12, 0.18);
    // 雲が厚いほど空は灰色に、日差しは弱くなる（晴れの日の少しの雲では変えない）
    const gloom = THREE.MathUtils.smoothstep(weather.cover, 0.3, 1);
    const glow = (1 - THREE.MathUtils.smoothstep(Math.abs(e), 0, 0.35)) * (1 - gloom * 0.8); // 日の出・日の入りのころほど 1
    this.daylight = day * (1 - gloom * 0.35);
    this.overcast.set(PALETTE.rock).multiplyScalar(THREE.MathUtils.lerp(NIGHT_SKY * 1.4, 1.05, day) * (1 - weather.storm * STORM_DARK));

    // 空：夜は暗い紺、昼は空色。地平線に太陽があるころは赤く染める
    this.color.copy(this.nightSky).lerp(this.daySky, day).lerp(this.dusk, glow * DUSK_TINT * Math.max(day, 0.3));
    this.color.lerp(this.overcast, gloom * OVERCAST_TINT);

    this.hemi.color.copy(this.nightSky).lerp(this.daySky, day).lerp(this.dusk, glow * 0.25);
    // 夜の空の光は海の色で青白く
    if (day < 1) this.hemi.color.lerp(this.sea, (1 - day) * 0.6);
    this.hemi.groundColor.set(PALETTE.grass).multiplyScalar(THREE.MathUtils.lerp(NIGHT_GROUND, 1, day));
    this.hemi.color.lerp(this.overcast, gloom * 0.5);
    this.hemi.intensity = THREE.MathUtils.lerp(NIGHT_HEMI, DAY_HEMI, day) * (1 - gloom * OVERCAST_HEMI);

    // 影を作る光：昼は太陽、夜は月（地平線をまたぐときはどちらも弱くなるので切り替わりは目立たない）
    if (e >= 0) {
      this.light.position.copy(this.sunDir).multiplyScalar(LIGHT_DISTANCE);
      this.light.color.copy(this.white).lerp(this.dusk, glow * 0.45);
      this.light.intensity = SUN_INTENSITY * THREE.MathUtils.smoothstep(e, 0, 0.15);
    } else {
      this.light.position.set(-this.sunDir.x, -this.sunDir.y, this.sunDir.z).multiplyScalar(LIGHT_DISTANCE);
      this.light.color.set(PALETTE.sky);
      this.light.intensity = MOON_INTENSITY * THREE.MathUtils.smoothstep(-e, 0, 0.15);
    }
    this.light.intensity *= 1 - gloom * OVERCAST_SUN;

    // 雷：嵐のときときどき空がぱっと光る（光る瞬間は自分の画面だけの演出なので Math.random で決める）
    if (weather.storm > 0 && Math.random() < (dt * weather.storm) / LIGHTNING_INTERVAL) this.flash = 1;
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.5);
      const k = this.flash * (0.6 + 0.4 * Math.sin(this.flash * 40)); // ちらつかせる
      this.color.lerp(this.white, k * 0.55);
      this.hemi.color.lerp(this.white, k * 0.7);
      this.hemi.intensity += k * LIGHTNING_HEMI;
    }

    // 天球：カメラについていき、時刻のぶん回す
    this.dome.position.copy(camera.position);
    this.sphere.rotation.z = a;
    this.dome.updateMatrixWorld(true);
    this.sun.lookAt(camera.position);
    this.moon.lookAt(camera.position);
    this.sun.material.color.set(PALETTE.sand).lerp(this.dusk, glow * 0.6);
    // 沈んだら海越しに透けて見えないように消す。厚い雲の向こうでもほとんど見えなくする
    this.sun.material.opacity = THREE.MathUtils.smoothstep(e, -0.06, 0.04) * (1 - gloom * 0.9);
    this.moon.material.opacity = THREE.MathUtils.smoothstep(-e, -0.06, 0.04) * (1 - gloom * 0.9);
    this.stars.material.opacity = (1 - THREE.MathUtils.smoothstep(day, 0.05, 0.6)) * (1 - gloom);
    this.stars.visible = this.stars.material.opacity > 0;

    // 雲：多さに合わせて数を増やし、暗い天気ほど灰色にする
    this.cloudLayer.rotation.y = minutes * CLOUD_DRIFT;
    this.cloudMesh.material.color
      .copy(this.cloudWhite)
      .multiplyScalar(THREE.MathUtils.lerp(0.18, 1, day))
      .lerp(this.dusk, glow * 0.45)
      .lerp(this.overcast, gloom * 0.85)
      .multiplyScalar(1 - gloom * 0.12); // 厚い雲は空より少し暗く
    this.updateClouds(weather.cover);
  }

  /** 雲の多さに合わせて、出す雲をふくらませ、出さない雲を縮めて消す */
  private updateClouds(cover: number): void {
    if (Math.abs(cover - this.shownCover) < 0.002) return;
    this.shownCover = cover;
    const m = new THREE.Matrix4();
    const shrink = new THREE.Matrix4();
    let i = 0;
    for (const { need, puffs } of this.clouds) {
      const k = THREE.MathUtils.smoothstep(cover - need * 0.95, 0, 0.12);
      for (const puff of puffs) {
        // ふくらみの中心へ向けて縮める（0 にすると法線が壊れるので、ごく小さくして残す）
        shrink.makeScale(Math.max(k, 0.0001), Math.max(k, 0.0001), Math.max(k, 0.0001));
        m.copy(puff);
        const e = m.elements;
        const [x, y, z] = [e[12], e[13], e[14]];
        e[12] = e[13] = e[14] = 0;
        m.premultiply(shrink).setPosition(x, y, z);
        this.cloudMesh.setMatrixAt(i++, m);
      }
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true;
  }
}
