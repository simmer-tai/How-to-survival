import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import { buildAxe, buildFishingRod, buildHammer, buildHoe, buildPickaxe, buildShovel, buildSpear, buildStoneKnife } from '../player/hand.js';
import { PLANK_T, buildFishModel, buildLeafModel, buildPlankModel, buildStickModel, buildCoinModel, buildBoatModel, buildBlueprintModel, buildMapModel, buildIslandMapModel, buildLandInfoModel, buildSeedModel, buildDirtModel, buildIronOreModel, buildTorchModel, type BlueprintKind } from './itemModels.js';
import { pieceIconModel } from '../actions/pieces.js';
import { FISH_KINDS, type FishId } from './fishKinds.js';
import type { ItemId } from './inventory.js';
import { perLandInfo, type LandKind } from './landInfo.js';

const ICON_SIZE = 128; // 描画解像度（px）。表示はこれより小さく縮める
const FOV = 24;

function part(geometry: THREE.BufferGeometry, color: number | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, typeof color === 'number' ? flat(color) : color);
  mesh.position.set(x, y, z);
  return mesh;
}

/** 道具を「柄が左下 → 先端が右上」の斜めに寝かせる */
function diagonal(model: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  model.rotation.z -= Math.PI / 4;
  g.add(model);
  return g;
}

/** 丸太を3本積んだ山。側面は樹皮、切り口は明るい色 */
function buildWood(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.13, 0.13, 0.62, 7);
  const mats = [flat(PALETTE.trunk), flat(PALETTE.sand), flat(PALETTE.sand)];
  for (const [x, y] of [[-0.135, 0], [0.135, 0], [0, 0.23]]) {
    const log = part(geo, mats, x, y, 0);
    log.rotation.x = Math.PI / 2; // 切り口を手前へ
    g.add(log);
  }
  g.rotation.set(0.35, -0.6, 0);
  return g;
}

/** 2枚重ねた板。上の板は少しずらして斜めに置く */
function buildPlanks(): THREE.Group {
  const g = new THREE.Group();
  for (const [y, z, turn] of [[0, 0.04, 0], [PLANK_T, -0.05, 0.25]]) {
    const board = buildPlankModel();
    board.position.set(0, y, z);
    board.rotation.y = turn;
    g.add(board);
  }
  g.rotation.set(0.6, -0.5, 0);
  return g;
}

/** 付け根で重なった2枚の葉っぱ */
function buildLeafIcon(): THREE.Group {
  const g = new THREE.Group();
  for (const [x, tilt] of [[-0.01, 0.4], [0.01, -0.3]]) { // 葉柄の付け根をそろえて V 字に
    const leaf = buildLeafModel();
    leaf.position.x = x;
    leaf.rotation.z = tilt;
    g.add(leaf);
  }
  g.rotation.set(0.35, -0.3, 0);
  return g;
}

function buildStone(): THREE.Group {
  const g = new THREE.Group();
  const rock = part(new THREE.DodecahedronGeometry(0.3, 0), PALETTE.rock);
  rock.scale.set(1.15, 0.75, 0.95);
  rock.rotation.set(0.3, 0.5, 0.15);
  const pebble = part(new THREE.DodecahedronGeometry(0.13, 0), PALETTE.rock, 0.3, -0.12, 0.12);
  pebble.rotation.set(0.8, 0.2, 0.4);
  g.add(rock, pebble);
  g.rotation.set(0.4, -0.3, 0);
  return g;
}

/** 鉄鉱石：ふたつ寄せたかたまりを、少し上から見る */
function buildIronOreIcon(): THREE.Group {
  const g = new THREE.Group();
  const big = buildIronOreModel();
  big.scale.setScalar(1.6);
  const small = buildIronOreModel();
  small.scale.setScalar(1.0);
  small.position.set(0.3, -0.1, 0.12);
  small.rotation.y = 1.4;
  g.add(big, small);
  g.rotation.set(0.4, -0.3, 0);
  return g;
}

/** 土：ふたつ寄せたかたまりを、少し上から見る */
function buildDirtIcon(): THREE.Group {
  const g = new THREE.Group();
  const big = buildDirtModel();
  const small = buildDirtModel();
  small.scale.setScalar(0.6);
  small.position.set(0.24, -0.06, 0.1);
  small.rotation.y = 1.4;
  g.add(big, small);
  g.rotation.set(0.45, -0.3, 0);
  return g;
}

/** 芽の出た木の種 */
function buildSeed(): THREE.Group {
  const g = new THREE.Group();
  const seed = (x: number, y: number, z: number, tilt: number) => {
    const s = buildSeedModel(); // 手に持つ木の種と同じ形
    s.position.set(x, y, z);
    s.rotation.z = tilt;
    g.add(s);
  };
  seed(-0.15, -0.08, 0, 0.5);
  seed(0.12, -0.12, 0.08, -0.4);
  seed(0, 0.05, -0.05, 0.1);
  // 芽：茎と2枚の葉
  g.add(part(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 5), PALETTE.grass, 0, 0.24, -0.05));
  const leafGeo = new THREE.SphereGeometry(0.1, 8, 6);
  for (const side of [-1, 1]) {
    const leaf = part(leafGeo, PALETTE.grass, side * 0.09, 0.36, -0.05);
    leaf.scale.set(1, 0.35, 0.6);
    leaf.rotation.z = side * 0.4;
    g.add(leaf);
  }
  g.rotation.set(0.3, -0.4, 0);
  return g;
}

function buildBerry(): THREE.Group {
  const g = new THREE.Group();
  const berryGeo = new THREE.SphereGeometry(0.15, 12, 10);
  for (const [x, y, z] of [[-0.14, -0.1, 0.05], [0.14, -0.1, 0.05], [0, 0.1, 0], [0, -0.06, -0.15]]) {
    g.add(part(berryGeo, PALETTE.accent, x, y, z));
  }
  // へたの葉
  const leafGeo = new THREE.SphereGeometry(0.1, 8, 6);
  for (const side of [-1, 1]) {
    const leaf = part(leafGeo, PALETTE.leaf, side * 0.1, 0.3, 0);
    leaf.scale.set(1, 0.3, 0.55);
    leaf.rotation.z = side * 0.5;
    g.add(leaf);
  }
  g.add(part(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 5), PALETTE.leaf, 0, 0.27, 0));
  g.rotation.set(0.35, -0.3, 0);
  return g;
}

function buildSword(): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.04, 0);
  s.lineTo(0.04, 0);
  s.lineTo(0.04, 0.5);
  s.lineTo(0, 0.6);
  s.lineTo(-0.04, 0.5);
  s.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(s, {
    depth: 0.01, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 1,
  });
  bladeGeo.translate(0, 0.02, -0.005);
  g.add(part(bladeGeo, PALETTE.rock));
  g.add(part(new THREE.BoxGeometry(0.24, 0.04, 0.06), PALETTE.trunk, 0, 0.0, 0)); // つば
  g.add(part(new THREE.CylinderGeometry(0.026, 0.026, 0.15, 6), PALETTE.accent, 0, -0.095, 0)); // 握り
  g.add(part(new THREE.SphereGeometry(0.04, 8, 6), PALETTE.trunk, 0, -0.18, 0)); // 柄頭
  return g;
}

/** 輪に巻いたツルの束。巻き終わりの端を少し垂らし、葉を2枚つける */
function buildVineIcon(): THREE.Group {
  const g = new THREE.Group();
  const ringGeo = new THREE.TorusGeometry(0.24, 0.022, 5, 18);
  for (const [x, y, tilt] of [[0, 0, 0.1], [0.03, 0.02, -0.15], [-0.02, 0.03, 0.3]]) {
    const ring = part(ringGeo, PALETTE.leaf, x, y, 0);
    ring.rotation.set(tilt, tilt * 0.5, 0);
    g.add(ring);
  }
  const tail = part(new THREE.CylinderGeometry(0.02, 0.016, 0.22, 5), PALETTE.leaf, 0.27, -0.12, 0.02);
  tail.rotation.z = 0.5;
  g.add(tail);
  for (const [x, y, z, turn] of [[-0.2, 0.17, 0.05, 0.8], [0.22, 0.12, 0.04, -0.6]]) {
    const leaf = buildLeafModel();
    leaf.scale.setScalar(0.5);
    leaf.position.set(x, y, z);
    leaf.rotation.z = turn;
    g.add(leaf);
  }
  g.rotation.set(0.5, -0.3, 0);
  return g;
}

/** 魚：頭を左下へ向けて、少し上から見る（平たい魚は上から背中を見せる） */
function buildFishIcon(id: FishId): THREE.Group {
  const g = new THREE.Group();
  const fish = buildFishModel(id);
  if (FISH_KINDS[id].flat) {
    fish.rotation.set(0.9, 0, 0.35);
  } else {
    fish.rotation.z = 0.35;
  }
  g.add(fish);
  g.rotation.set(0.35, 0.3, 0);
  return g;
}

/** コイン：少しずらして重ねた2枚。上の1枚の面を見せる */
function buildCoinIcon(): THREE.Group {
  const g = new THREE.Group();
  const back = buildCoinModel();
  back.position.set(0.1, -0.08, -0.06);
  const front = buildCoinModel();
  front.position.set(-0.04, 0.03, 0.04);
  front.rotation.z = 0.2;
  g.add(back, front);
  g.rotation.set(-0.35, 0.3, 0);
  return g;
}

/** 船：舳先を右へ向けて、斜め上から中が見えるように */
function buildBoatIcon(): THREE.Group {
  const g = new THREE.Group();
  g.add(buildBoatModel());
  g.rotation.set(0.5, -0.5, 0);
  return g;
}

/** 設計図：紙の表（図面）をこちらへ向けて、少し傾ける */
function buildBlueprintIcon(kind: BlueprintKind): THREE.Group {
  const g = new THREE.Group();
  const sheet = buildBlueprintModel(kind);
  sheet.rotation.x = Math.PI / 2 - 0.35;
  g.add(sheet);
  g.rotation.set(0, -0.25, 0.1);
  return g;
}

/** 地形のメモ：設計図と同じように、紙の表をこちらへ向けて少し傾ける */
function buildLandInfoIcon(kind: LandKind): THREE.Group {
  const g = new THREE.Group();
  const sheet = buildLandInfoModel(kind);
  sheet.rotation.x = Math.PI / 2 - 0.35;
  g.add(sheet);
  g.rotation.set(0, -0.15, 0.06);
  return g;
}

/** 地図（白紙の地図・島の地図）：紙の表をこちらへ向けて、少し傾ける */
function buildMapIcon(build: () => THREE.Group): THREE.Group {
  const g = new THREE.Group();
  const sheet = build();
  sheet.rotation.x = Math.PI / 2 - 0.35;
  g.add(sheet);
  g.rotation.set(0, 0.2, -0.08);
  return g;
}

/** 斧やハンマーやナイフ：刃や打つ面（-Z）を画面の左へ向けて横顔を見せる */
function sideView(tool: THREE.Group): THREE.Group {
  tool.rotation.y = Math.PI / 2;
  const g = new THREE.Group();
  g.add(tool);
  return g;
}

/** スコップ：くぼんだ刃の面（-Z）を手前へ向ける */
function frontView(tool: THREE.Group): THREE.Group {
  tool.rotation.y = Math.PI;
  const g = new THREE.Group();
  g.add(tool);
  return g;
}

/** アイテムごとの 3D モデル（新しいアイテムはここに追加する） */
const MODELS: Record<ItemId, () => THREE.Object3D> = {
  wood: buildWood,
  plank: buildPlanks,
  stick: () => tools(buildStickModel()),
  leaf: buildLeafIcon,
  stone: buildStone,
  dirt: buildDirtIcon,
  ironOre: buildIronOreIcon,
  seed: buildSeed,
  berry: buildBerry,
  fish: () => buildFishIcon('fish'),
  clownfish: () => buildFishIcon('clownfish'),
  snapper: () => buildFishIcon('snapper'),
  puffer: () => buildFishIcon('puffer'),
  flounder: () => buildFishIcon('flounder'),
  bonito: () => buildFishIcon('bonito'),
  coin: buildCoinIcon,
  boatBlueprint: () => buildBlueprintIcon('boat'),
  pickaxeBlueprint: () => buildBlueprintIcon('pickaxe'),
  spearBlueprint: () => buildBlueprintIcon('spear'),
  hammerBlueprint: () => buildBlueprintIcon('hammer'),
  fishingRodBlueprint: () => buildBlueprintIcon('fishingRod'),
  draftingTableBlueprint: () => buildBlueprintIcon('draftingTable'),
  hoeBlueprint: () => buildBlueprintIcon('hoe'),
  map: () => buildMapIcon(buildMapModel),
  islandMap: () => buildMapIcon(buildIslandMapModel),
  ...perLandInfo((k) => () => buildLandInfoIcon(k)),
  boat: buildBoatIcon,
  hoe: () => tools(sideView(buildHoe())),
  axe: () => tools(sideView(buildAxe())),
  sword: () => tools(buildSword()),
  stoneKnife: () => tools(sideView(buildStoneKnife())),
  spear: () => tools(sideView(buildSpear())),
  vine: buildVineIcon,
  hammer: () => tools(sideView(buildHammer())),
  pickaxe: () => tools(sideView(buildPickaxe())),
  shovel: () => tools(frontView(buildShovel())),
  fishingRod: () => tools(sideView(buildFishingRod())),
  workbench: () => pieceIconModel('workbench'),
  draftingTable: () => pieceIconModel('draftingTable'),
  campfire: () => pieceIconModel('campfire'),
  torch: () => tools(buildTorchModel(false)),
};

/** 道具は斜めに置いて、少し奥行きが見える角度から見る */
function tools(model: THREE.Object3D): THREE.Group {
  const g = diagonal(model);
  g.rotation.set(0.3, -0.45, 0);
  return g;
}

// ---- アイコン撮影用のスタジオ（ゲーム画面とは別の小さなレンダラー） ----
let studio: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;

function getStudio() {
  if (studio) return studio;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(ICON_SIZE, ICON_SIZE, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(PALETTE.sky, PALETTE.grass, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(1.5, 2.5, 3);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 50);
  studio = { renderer, scene, camera };
  return studio;
}

/** アイテムの 3D モデル（作業台の上に置く素材などに使う）。共有でないジオメトリは使い終わったら捨てる */
export function itemModel(id: ItemId): THREE.Object3D {
  return MODELS[id]();
}

/** itemModel で作ったモデルを捨てる（マテリアルと共有ジオメトリは残す） */
export function disposeModel(model: THREE.Object3D): void {
  model.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.geometry.userData.shared) o.geometry.dispose();
  });
}

const cache = new Map<string, string>();

/** アイテムの 3D アイコン（PNG の data URL）。初回だけ描画してキャッシュする */
export function itemIcon(id: ItemId): string {
  return modelIcon(`item:${id}`, MODELS[id]);
}

/** 任意の 3D モデルのアイコン。key ごとに初回だけ描画してキャッシュする */
export function modelIcon(key: string, build: () => THREE.Object3D): string {
  const cached = cache.get(key);
  if (cached) return cached;
  const { renderer, scene, camera } = getStudio();
  const model = build();
  scene.add(model);

  // 画面に映る幅・高さがちょうど収まる距離にカメラを置く（カメラは -Z 向きなので xy がそのまま画面の縦横）
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const half = (Math.max(size.x, size.y) / 2) * 1.08;
  const dist = half / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) + size.z / 2;
  camera.position.set(center.x, center.y, center.z + dist);
  camera.lookAt(center);
  camera.near = dist - size.z;
  camera.far = dist + size.z;
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  cache.set(key, url);

  scene.remove(model);
  disposeModel(model); // マテリアルはゲームと共有なので捨てない。itemModels のジオメトリも共有なので残す
  return url;
}
