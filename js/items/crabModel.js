import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
// カニの体（甲羅・はさみ・脚・目）。砂浜を歩くカニ（world/crabs.ts）と、倒したカニのアイテム（脚を閉じた姿）で使う
const LEG_COUNT = 4; // 片側の脚の数
const LEG_THIGH = 0.17; // もも（付け根からひざまで）の長さ
const LEG_SHIN = 0.22; // すね（ひざから先まで）の長さ
const LEG_TIP = 0.06; // 脚の先の爪の長さ
export const LEG_UP = 0.75; // ももを持ち上げる角度（rad）
export const LEG_BEND = -2.1; // ひざで曲げる角度（rad。下へ折って先を地面につける）
export const BODY_Y = 0.17; // 甲羅の中心の高さ（脚で持ち上げる高さ）
export const SCALE = 0.55; // カニの大きさの倍率
const FOLD_UP = -1.1; // 脚を閉じたときの、ももの角度（rad。下へ向ける）
const FOLD_BEND = -2.6; // 脚を閉じたときの、ひざの角度（rad。すねを体の下へたたむ）
const FOLD_FAN = 0.4; // 脚を閉じたときに、前後に開いた脚の向きを寄せる割合（1 で全部まっすぐ横）
const FOLD_ARM = { x: 0.35, y: -0.7 }; // はさみを閉じたときの、腕の付け根の角度（rad。下へ・内へ）
const SHELL = new THREE.Color(PALETTE.accent);
const LEG = SHELL.clone().multiplyScalar(0.75);
const TIP = SHELL.clone().lerp(new THREE.Color(PALETTE.sand), 0.35); // 脚の先とはさみの指（白っぽい）
const EYE = new THREE.Color(PALETTE.bark).multiplyScalar(0.5);
/** 先の細い棒（関節の台の +x の向きに伸びる。脚の節に使う） */
function segment(length, base, tip, mat) {
    const geo = new THREE.CylinderGeometry(tip, base, length, 5);
    geo.rotateZ(-Math.PI / 2); // 軸を +x に向ける（細いほうが先）
    geo.translate(length / 2, 0, 0);
    return new THREE.Mesh(geo, mat);
}
/** 先の細いとがった指（+z の向きに伸びる。はさみの指に使う） */
function fingerShape(length, base, mat) {
    const geo = new THREE.CylinderGeometry(0.004, base, length, 5);
    geo.rotateX(Math.PI / 2); // 軸を +z に向ける（とがったほうが先）
    geo.translate(0, 0, length / 2);
    geo.scale(1, 0.75, 1); // 上下に少し平たく
    return new THREE.Mesh(geo, mat);
}
/** 脚1本を作る。右側の向き（付け根から +x の外へ）で組み、ひざで下へ折って先を地面につける */
function buildLeg(mat, tipMat) {
    const root = new THREE.Group();
    const hip = new THREE.Group();
    hip.rotation.z = LEG_UP; // ももは外へ、少し上向きに
    hip.add(segment(LEG_THIGH, 0.022, 0.016, mat));
    const knee = new THREE.Group();
    knee.position.x = LEG_THIGH;
    knee.rotation.z = LEG_BEND; // ひざで下へ折る
    knee.add(segment(LEG_SHIN, 0.016, 0.01, mat));
    // ひざの継ぎ目の玉と、脚の先のとがった爪
    const joint = new THREE.Mesh(new THREE.IcosahedronGeometry(0.018, 0), mat);
    const tip = segment(LEG_TIP, 0.01, 0.002, tipMat);
    tip.position.x = LEG_SHIN;
    tip.rotation.z = -0.35;
    knee.add(joint, tip);
    hip.add(knee);
    root.add(hip);
    return { root, hip, knee };
}
/** はさみ1本を作る。右側の向きで、肩から前へ腕を伸ばし、ひじで内へ曲げ、手のひらから上下2本の指が出る */
function buildClaw(shell, leg, tipMat, size) {
    const root = new THREE.Group();
    const shoulder = new THREE.Group();
    shoulder.rotation.set(-0.25, 0.55, 0); // 前・外向き、少し上へ
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, 0.13).translate(0, 0, 0.065), leg);
    const elbow = new THREE.Group();
    elbow.position.z = 0.13;
    elbow.rotation.set(0.2, -1.05, 0); // ひじで内へ曲げる
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.09).translate(0, 0, 0.045), shell);
    const elbowJoint = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), leg);
    const wrist = new THREE.Group();
    wrist.position.z = 0.09;
    wrist.rotation.y = 0.5; // 手首で少し外へ向け直す
    wrist.scale.setScalar(size);
    // 手のひら（ふくらんだ甲羅）と、下の動かない指・上の動く指
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), shell);
    palm.scale.set(0.85, 0.75, 1.25);
    palm.position.z = 0.07;
    const fixed = fingerShape(0.1, 0.034, tipMat);
    fixed.position.set(0, -0.018, 0.14);
    fixed.rotation.x = -0.12;
    const finger = new THREE.Group();
    finger.position.set(0, 0.025, 0.13);
    const moving = fingerShape(0.095, 0.028, tipMat);
    finger.add(moving);
    wrist.add(palm, fixed, finger);
    elbow.add(fore, elbowJoint, wrist);
    shoulder.add(upper, elbow);
    root.add(shoulder);
    return { root, finger };
}
/** カニ1匹の体（甲羅・はさみ・脚・目）。脚とはさみは関節ごとに動かす。歩く姿勢で作る */
export function buildCrab() {
    const root = new THREE.Group();
    const shell = flat(SHELL.getHex());
    const leg = flat(LEG.getHex());
    const tip = flat(TIP.getHex());
    const eye = flat(EYE.getHex());
    // 甲羅：横に広い平たい楕円に、前のふちのでこぼこ
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 5), shell);
    body.scale.set(1.25, 0.45, 0.92);
    body.position.y = BODY_Y;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 3), leg);
    belly.scale.set(1.15, 0.25, 0.85);
    belly.position.y = BODY_Y - 0.035;
    root.add(body, belly);
    for (const x of [-0.1, 0, 0.1]) {
        const bump = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), shell);
        bump.position.set(x, BODY_Y + 0.03, 0.18);
        root.add(bump);
    }
    // 目（甲羅の前から突き出た2本）
    for (const s of [-1, 1]) {
        const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.02), leg);
        stalk.position.set(s * 0.06, BODY_Y + 0.08, 0.16);
        const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.028, 0), eye);
        ball.position.set(s * 0.06, BODY_Y + 0.125, 0.16);
        root.add(stalk, ball);
    }
    // はさみ（前の左右。右のほうが少し大きい）
    const claws = [];
    for (const s of [-1, 1]) {
        const { root: arm, finger } = buildClaw(shell, leg, tip, s > 0 ? 1.15 : 1);
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.13, BODY_Y, 0.15);
        pivot.scale.x = s; // 左は左右反転
        pivot.add(arm);
        root.add(pivot);
        claws.push({ pivot, arm, finger, offset: s > 0 ? 0 : 1.7 });
    }
    // 脚（左右に4本ずつ。付け根の台を体のふちに置き、前から後ろへ扇のように向きを変える）
    const legs = [];
    for (const s of [-1, 1]) {
        for (let i = 0; i < LEG_COUNT; i++) {
            const { root: limb, hip, knee } = buildLeg(leg, tip);
            const pivot = new THREE.Group();
            const z = 0.09 - i * 0.075;
            pivot.position.set(s * 0.2, BODY_Y - 0.01, z);
            pivot.rotation.y = -s * (0.45 - i * 0.3); // 前の脚は前へ、後ろの脚は後ろへ向ける
            pivot.scale.x = s;
            pivot.add(limb);
            root.add(pivot);
            // 左右の同じ番号の脚、となりの脚どうしは逆のタイミングで動かす（交互に歩く）
            legs.push({ pivot, hip, knee, fan: pivot.rotation.y, offset: i * Math.PI + (s > 0 ? Math.PI / 2 : 0) });
        }
    }
    root.scale.setScalar(SCALE);
    root.traverse((o) => {
        if (o instanceof THREE.Mesh)
            o.castShadow = true;
    });
    return { root, legs, claws };
}
/**
 * 脚とはさみを閉じる（k は 0 で歩く姿勢、1 で閉じきった姿勢）。
 * 脚はすねを体の下へたたみ、はさみは腕を内へ寄せて指を閉じる
 */
export function foldCrab(body, k) {
    for (const leg of body.legs) {
        leg.pivot.rotation.y = leg.fan * (1 - FOLD_FAN * k);
        leg.hip.rotation.y *= 1 - k;
        leg.hip.rotation.z = THREE.MathUtils.lerp(leg.hip.rotation.z, FOLD_UP, k);
        leg.knee.rotation.z = THREE.MathUtils.lerp(leg.knee.rotation.z, FOLD_BEND, k);
    }
    for (const claw of body.claws) {
        claw.arm.rotation.set(FOLD_ARM.x * k, FOLD_ARM.y * k, 0);
        claw.finger.rotation.x *= 1 - k;
    }
}
/** 倒したカニのアイテムの見た目（脚とはさみを閉じた姿）。原点は甲羅の下の地面 */
export function buildCrabModel() {
    const body = buildCrab();
    foldCrab(body, 1);
    return body.root;
}
