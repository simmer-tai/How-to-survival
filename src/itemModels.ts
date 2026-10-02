import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { toon } from './materials.js';

const LEAF_LENGTH = 0.36;
const LEAF_WIDTH = 0.12;
const LEAF_FOLD = 0.3; // 葉脈を谷にして左右の葉身を起こす角度（rad）

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
};
for (const geo of Object.values(GEO)) geo.userData.shared = true; // アイコン撮影後に捨てられないように

/** 葉っぱ1枚。葉脈で少し折れた形。原点は葉柄の付け根で、先端が +Y、表が +Z */
export function buildLeafModel(): THREE.Group {
  const g = new THREE.Group();
  const left = new THREE.Mesh(GEO.halfLeft, toon(PALETTE.leaf));
  left.rotation.y = LEAF_FOLD;
  const right = new THREE.Mesh(GEO.halfRight, toon(PALETTE.leaf));
  right.rotation.y = -LEAF_FOLD;
  const midrib = new THREE.Mesh(GEO.midrib, toon(PALETTE.grass));
  midrib.position.z = 0.008;
  const petiole = new THREE.Mesh(GEO.petiole, toon(PALETTE.grass));
  petiole.position.y = 0.005;
  g.add(left, right, midrib, petiole);
  return g;
}

/** 小枝と葉が1枚ついた、途中で少し曲がった枝。原点は枝の中ほどで、軸は Y */
export function buildStickModel(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = -0.38; // 全長の中ほどを原点にする
  g.add(body);

  body.add(new THREE.Mesh(GEO.stickLower, toon(PALETTE.trunk)));
  const upper = new THREE.Mesh(GEO.stickUpper, toon(PALETTE.trunk));
  upper.position.y = 0.41;
  upper.rotation.z = 0.2; // 節で少し折れ曲がる
  body.add(upper);
  const knot = new THREE.Mesh(GEO.knot, toon(PALETTE.trunk));
  knot.position.y = 0.41;
  knot.scale.set(1, 0.8, 1);
  body.add(knot);

  // 節から分かれた小枝と、その先の葉
  const twig = new THREE.Group();
  twig.position.y = 0.3;
  twig.rotation.z = -0.75;
  twig.add(new THREE.Mesh(GEO.twig, toon(PALETTE.trunk)));
  const leaf = buildLeafModel();
  leaf.position.y = 0.19;
  leaf.rotation.z = 0.35;
  leaf.scale.setScalar(0.45);
  twig.add(leaf);
  body.add(twig);
  return g;
}
