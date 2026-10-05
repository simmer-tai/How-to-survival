import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';

const LEAF_LENGTH = 0.36;
const LEAF_WIDTH = 0.12;
const LEAF_FOLD = 0.3; // 葉脈を谷にして左右の葉身を起こす角度（rad）
export const PLANK_L = 0.8; // 板の長さ
const PLANK_W = 0.22; // 板の幅
export const PLANK_T = 0.06; // 板の厚み

/** 葉身の片側（葉脈 x=0 から side の向きへふくらむ）。根元が原点、先端が +Y */
function halfLeafShape(side: 1 | -1): THREE.Shape {
  const w = LEAF_WIDTH * side;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(w * 0.9, LEAF_LENGTH * 0.08, w * 1.05, LEAF_LENGTH * 0.6, 0, LEAF_LENGTH);
  s.lineTo(0, 0);
  return s;
}

function extrudeThin(shape: THREE.Shape): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.01, curveSegments: 5, bevelEnabled: false });
  geo.translate(0, 0, -0.005);
  return geo;
}

export const BOBBER_R = 0.06; // ウキの玉の半径
const FISH_LENGTH = 0.42; // 魚の頭から尾の付け根までの長さ

/** 薄いひれ。pts は付け根を原点にした輪郭（x=後ろ, y=上） */
function finGeometry(pts: [number, number][]): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(...pts[0]);
  for (const p of pts.slice(1)) s.lineTo(...p);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
  geo.translate(0, 0, -0.006);
  return geo;
}

// 茂みから舞う葉などで何度も作るので、ジオメトリは共有する
const GEO = {
  halfLeft: extrudeThin(halfLeafShape(-1)),
  halfRight: extrudeThin(halfLeafShape(1)),
  midrib: new THREE.CylinderGeometry(0.006, 0.01, LEAF_LENGTH * 0.92, 4).translate(0, LEAF_LENGTH * 0.46, 0),
  petiole: new THREE.CylinderGeometry(0.008, 0.01, 0.07, 4).translate(0, -0.035, 0),
  stickLower: new THREE.CylinderGeometry(0.03, 0.036, 0.42, 6).translate(0, 0.21, 0),
  stickUpper: new THREE.CylinderGeometry(0.022, 0.03, 0.34, 6).translate(0, 0.17, 0),
  twig: new THREE.CylinderGeometry(0.012, 0.018, 0.2, 5).translate(0, 0.1, 0),
  knot: new THREE.DodecahedronGeometry(0.04, 0),
  berry: new THREE.SphereGeometry(0.1, 10, 8),
  berryStem: new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4).translate(0, 0.03, 0),
  plank: new THREE.BoxGeometry(PLANK_L, PLANK_T, PLANK_W),
  grain: new THREE.BoxGeometry(PLANK_L * 0.8, 0.004, 0.012),
  // ウキ：上半分と下半分の色を分けた玉と、上に立てた細い棒
  bobberTop: new THREE.SphereGeometry(BOBBER_R, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
  bobberBottom: new THREE.SphereGeometry(BOBBER_R, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
  bobberStem: new THREE.CylinderGeometry(0.006, 0.006, BOBBER_R * 1.2, 4).translate(0, BOBBER_R * 1.4, 0),
  // 魚：胴・腹・尾びれ・背びれ・目
  fishBody: new THREE.SphereGeometry(0.1, 10, 7).scale(FISH_LENGTH / 0.2, 1, 0.55),
  fishBelly: new THREE.SphereGeometry(0.08, 10, 6).scale(FISH_LENGTH / 0.2, 0.8, 0.5).translate(0.01, -0.03, 0),
  fishTail: finGeometry([[0, 0], [0.13, 0.09], [0.1, 0], [0.13, -0.09]]),
  fishFin: finGeometry([[0, 0], [0.05, 0.07], [0.12, 0]]),
  fishEye: new THREE.SphereGeometry(0.014, 6, 4),
};
for (const geo of Object.values(GEO)) geo.userData.shared = true; // アイコン撮影後に捨てられないように

/** 葉っぱ1枚。葉脈で少し折れた形。原点は葉柄の付け根で、先端が +Y、表が +Z */
export function buildLeafModel(): THREE.Group {
  const g = new THREE.Group();
  const left = new THREE.Mesh(GEO.halfLeft, flat(PALETTE.leaf));
  left.rotation.y = LEAF_FOLD;
  const right = new THREE.Mesh(GEO.halfRight, flat(PALETTE.leaf));
  right.rotation.y = -LEAF_FOLD;
  const midrib = new THREE.Mesh(GEO.midrib, flat(PALETTE.grass));
  midrib.position.z = 0.008;
  const petiole = new THREE.Mesh(GEO.petiole, flat(PALETTE.grass));
  petiole.position.y = 0.005;
  g.add(left, right, midrib, petiole);
  return g;
}

/** ベリー1粒（軸付き）。原点は実の中心 */
export function buildBerryModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(GEO.berry, flat(PALETTE.accent)));
  const stem = new THREE.Mesh(GEO.berryStem, flat(PALETTE.leaf));
  stem.position.y = 0.08;
  g.add(stem);
  return g;
}

/** 茂みになっている実（軸なし）。ジオメトリは共有 */
export function buildBushBerry(): THREE.Mesh {
  return new THREE.Mesh(GEO.berry, flat(PALETTE.accent));
}

/** 小枝と葉が1枚ついた、途中で少し曲がった枝。原点は枝の中ほどで、軸は Y */
export function buildStickModel(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = -0.38; // 全長の中ほどを原点にする
  g.add(body);

  body.add(new THREE.Mesh(GEO.stickLower, flat(PALETTE.trunk)));
  const upper = new THREE.Mesh(GEO.stickUpper, flat(PALETTE.trunk));
  upper.position.y = 0.41;
  upper.rotation.z = 0.2; // 節で少し折れ曲がる
  body.add(upper);
  const knot = new THREE.Mesh(GEO.knot, flat(PALETTE.trunk));
  knot.position.y = 0.41;
  knot.scale.set(1, 0.8, 1);
  body.add(knot);

  // 節から分かれた小枝と、その先の葉
  const twig = new THREE.Group();
  twig.position.y = 0.3;
  twig.rotation.z = -0.75;
  twig.add(new THREE.Mesh(GEO.twig, flat(PALETTE.trunk)));
  const leaf = buildLeafModel();
  leaf.position.y = 0.19;
  leaf.rotation.z = 0.35;
  leaf.scale.setScalar(0.45);
  twig.add(leaf);
  body.add(twig);
  return g;
}

/** 板1枚。茶色で、上面に濃い木目が2本。長さは X、原点は板の中心 */
export function buildPlankModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(GEO.plank, flat(PALETTE.trunk)));
  for (const [x, z] of [[-0.04, -0.05], [0.05, 0.04]]) {
    const grain = new THREE.Mesh(GEO.grain, flat(PALETTE.bark));
    grain.position.set(x, PLANK_T / 2 + 0.002, z);
    g.add(grain);
  }
  return g;
}

/** 釣り糸の先に付けるウキ。原点は玉の中心で、上半分が赤、下半分が砂色 */
export function buildBobberModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(GEO.bobberTop, flat(PALETTE.accent)));
  g.add(new THREE.Mesh(GEO.bobberBottom, flat(PALETTE.sand)));
  g.add(new THREE.Mesh(GEO.bobberStem, flat(PALETTE.trunk)));
  return g;
}

/** 釣れた魚。頭が -X、尾が +X を向き、原点は胴の中心 */
export function buildFishModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(GEO.fishBody, flat(PALETTE.water)));
  g.add(new THREE.Mesh(GEO.fishBelly, flat(PALETTE.sand)));
  const tail = new THREE.Mesh(GEO.fishTail, flat(PALETTE.water));
  tail.position.x = FISH_LENGTH / 2 - 0.03;
  g.add(tail);
  const fin = new THREE.Mesh(GEO.fishFin, flat(PALETTE.water));
  fin.position.set(-0.06, 0.085, 0);
  g.add(fin);
  for (const z of [-1, 1]) {
    const eye = new THREE.Mesh(GEO.fishEye, flat(PALETTE.bark));
    eye.position.set(-FISH_LENGTH / 2 + 0.05, 0.025, z * 0.045);
    g.add(eye);
  }
  return g;
}
