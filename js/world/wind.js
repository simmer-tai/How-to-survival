import * as THREE from 'three';
import { TREE_BLOTCH, withBlotch } from '../core/materials.js';
// 風（自分の画面だけの演出）。風の強さは天気（weather.ts の wind）から決まり、草・木の葉・茂みを揺らす。
// 揺れはその場の見た目だけで、当たり判定や共有ワールドの状態は変えない
/** 風が吹いていく向き（XZ。雨が流れる向きと同じ） */
export const WIND_DIR = new THREE.Vector2(0.8, 0.6);
const PHASE_SPEED = 1; // 揺れの速さ（風がないとき）
const PHASE_SPEED_WIND = 1.6; // 強い風のときに揺れの速さへ足す分
const TREE_SWAY = 0.6; // いちばん強い風で、木の葉の先が風下へ寄る量（m）
const TREE_FLUTTER = 0.06; // いちばん強い風で、木の葉が細かく震える量（m）
const BUSH_TILT = 0.12; // いちばん強い風で、茂みが風下へ傾く角度（rad）
const BUSH_FLUTTER = 0.03; // いちばん強い風で、茂みが細かく揺れる角度（rad）
/**
 * 揺れに使う値（シェーダーで共有する）。uWindTime は揺れの位相で、風の強さに合わせた速さで毎フレーム積み上げる
 * （経過時間に速さを掛けると、風が変わった瞬間に揺れが飛ぶので）
 */
export const windUniforms = {
    uWindTime: { value: 0 },
    /** 風の強さ（0〜1） */
    uWind: { value: 0 },
    uWindDir: { value: WIND_DIR },
};
/** 揺れの計算で使う GLSL（windUniforms を渡したシェーダーで使う） */
export const WIND_GLSL = /* glsl */ `
uniform float uWindTime;
uniform float uWind;
uniform vec2 uWindDir;
/** 場所ごとに時間差のある突風（0〜1） */
float windGust(vec2 p) {
  return sin(dot(p, vec2(0.11, 0.07)) - uWindTime * 1.3) * 0.5 + 0.5;
}
`;
/** 木の葉の揺れ：頂点の揺れやすさ aSway（0 = 動かない、1 = いちばん揺れる）に合わせて、風下へ寄せて細かく震わせる */
const TREE_SWAY_GLSL = /* glsl */ `
#include <begin_vertex>
{
  vec3 rootW = modelMatrix[3].xyz;
  float gust = windGust(rootW.xz);
  vec2 lean = uWindDir * uWind * (0.3 + 0.7 * gust) * ${TREE_SWAY.toFixed(2)};
  vec3 flutter = sin(position.zxy * 2.3 + uWindTime * vec3(5.1, 4.3, 6.2) + rootW.x) * uWind * ${TREE_FLUTTER.toFixed(2)};
  vec3 offset = (vec3(lean.x, 0.0, lean.y) + flutter) * aSway;
  // ずらす量は世界の向き・長さなので、木の向きと大きさを戻してから足す
  transformed += inverse(mat3(modelMatrix)) * offset;
}`;
function addTreeSway(shader) {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aSway;\n${WIND_GLSL}`)
        .replace('#include <begin_vertex>', TREE_SWAY_GLSL);
}
let treeMaterial = null;
let treeDepthMaterial = null;
/** 風で揺れる木の葉の材質（頂点に色と揺れやすさ aSway を持つジオメトリに使う） */
export function swayMaterial() {
    if (!treeMaterial) {
        treeMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
        treeMaterial.onBeforeCompile = addTreeSway;
        withBlotch(treeMaterial, TREE_BLOTCH, 'tree'); // 葉にも幹と同じドット絵を足す
    }
    return treeMaterial;
}
/** 揺れる木の葉の影（影も葉と一緒に揺らす。メッシュの customDepthMaterial にする） */
export function swayDepthMaterial() {
    if (!treeDepthMaterial) {
        treeDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        treeDepthMaterial.onBeforeCompile = addTreeSway;
    }
    return treeDepthMaterial;
}
/** 風の強さを持ち、揺れの値を進める。茂み（実が付いているので丸ごと）は物ごと傾ける */
export class Wind {
    /** 風の強さ（0〜1） */
    strength = 0;
    swaying = [];
    axis = new THREE.Vector3(WIND_DIR.y, 0, -WIND_DIR.x).normalize(); // この軸で回すと、上が風下へ倒れる
    tilt = new THREE.Quaternion();
    /** object を丸ごと風で傾ける（今の向きを、揺れていないときの向きにする） */
    addSwaying(object) {
        const p = object.position;
        this.swaying.push({ object, base: object.quaternion.clone(), phase: p.x * 0.11 + p.z * 0.07 });
    }
    /** strength は風の強さ（0〜1） */
    update(dt, strength) {
        this.strength = strength;
        windUniforms.uWind.value = strength;
        windUniforms.uWindTime.value += dt * (PHASE_SPEED + PHASE_SPEED_WIND * strength);
        const t = windUniforms.uWindTime.value;
        for (const s of this.swaying) {
            if (!s.object.visible)
                continue;
            const gust = Math.sin(s.phase - t * 1.3) * 0.5 + 0.5;
            const angle = strength * (BUSH_TILT * (0.3 + 0.7 * gust) + BUSH_FLUTTER * Math.sin(t * 5.3 + s.phase * 7));
            s.object.quaternion.copy(this.tilt.setFromAxisAngle(this.axis, angle)).multiply(s.base);
        }
    }
}
