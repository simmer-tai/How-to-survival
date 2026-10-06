import { HeightField, SEA_FLOOR, fbm } from './terrain.js';
import { chartRandom } from '../items/islandChart.js';
const SKELETONS = ['gentle', 'mountain', 'flat', 'long', 'cove', 'cliff', 'archipelago'];
const RADIUS_MIN = 38; // 島の大きさ（中心から海岸線まで）の最小（m）。船は中心から 82m の沖に着くので、島はその内側に収める
const RADIUS_MAX = 50;
const COAST_WOBBLE = 0.22; // 海岸線のでこぼこの大きさ（島の大きさに対する割合）
const BUMPS = 0.8; // 陸の小さな起伏の大きさ（m）
// ふつうの島の斜面：島の中心から海岸線までを 1 としたとき、高台から海底まで下る範囲と、高台の高さ（海底から）
const SLOPE = { inner: 0.55, outer: 1.3, top: 8.5 };
const FLAT = { inner: 0.7, outer: 1.2, top: 7.6 }; // 凪の平（平たい島）：低く、なだらか
const STEEP = { inner: 0.9, outer: 1.04, top: 12 }; // 拒む壁（崖の島）・切り立つ岸：高く、まっすぐ落ちる
const MOUNT_H = 15; // 天を衝く峰（山の島）の山の高さ（m）
const MOUNT_SPREAD = 0.42; // 山のすその広がり（島の大きさに対する割合）
const LONG_X = 1.3; // 竜の背（細長い島）の、長いほうの伸ばし方（海岸線が中心から 70m を超えないように）
const LONG_Z = 0.6; // 短いほうの縮め方
const BAY_AT = 0.6; // 三日月の懐（入り江の島）：湾の中心の、島の中心からの距離（島の大きさに対する割合）
const BAY_R = 0.62; // 湾の大きさ（島の大きさに対する割合）
const LANDING_WIDE = 0.75; // 崖の島で、上がれる坂になっている向きの広さ（向きの cos がこれより大きい所）
const CLIFF_WIDE = 0.55; // ほかの島の、切り立つ岸になっている向きの広さ
const ISLETS_MIN = 3; // 散らばる飛び石（群島）の島の数
const ISLETS_MAX = 5;
// 白い渚：海岸の、この高さの範囲を平たくつぶして砂浜を広げる
const BEACH_LOW = 0.3;
const BEACH_HIGH = 2.4;
const BEACH_FLAT = 0.4; // つぶしたあとの傾きの割合
const BEACH_LIFT = 1.4; // つぶした分、島全体を高くしておく（高台が低くなりすぎないように）
// 空を映す水：島の中のくぼみ。海面より低いので、海と同じ水面が張る
const LAKE_R_MIN = 8;
const LAKE_R_MAX = 14;
const LAKE_DEPTH = -1.8; // 湖の底の高さ
const LAKE_TRIES = 40; // 湖を置ける所が見つかるまで試す回数
const LAKE_GROUND = 1.5; // 湖の中心の、もとの地面の高さの下限
const LAKE_RIM = 0.8; // 湖のまわり（岸の少し外）の、もとの地面の高さの下限（海とつながらないように）
/** 島の地図の中身から、島の地面を作る */
export function isleShape(chart) {
    const rand = chartRandom(chart.seed + 3);
    const has = (k) => chart.lands.includes(k);
    const skeleton = SKELETONS[Math.floor(rand() * SKELETONS.length)];
    const R = RADIUS_MIN + rand() * (RADIUS_MAX - RADIUS_MIN);
    const waves = [2, 3, 5, 7].map((k) => ({ k, amp: rand(), phase: rand() * Math.PI * 2 }));
    const ampSum = waves.reduce((n, w) => n + w.amp, 0) || 1;
    /** 向き a の海岸線までの距離（1 がふつう） */
    const coast = (a) => 1 + (COAST_WOBBLE * waves.reduce((n, w) => n + w.amp * Math.sin(w.k * a + w.phase), 0)) / ampSum;
    const noiseX = rand() * 100;
    const noiseZ = rand() * 100;
    const turn = rand() * Math.PI; // 細長い島の向き
    const bayA = rand() * Math.PI * 2; // 入り江の湾の向き
    const sideA = rand() * Math.PI * 2; // 崖の島の上がれる向き・切り立つ岸の向き
    const mountX = (rand() - 0.5) * R * 0.3;
    const mountZ = (rand() - 0.5) * R * 0.3;
    // 群島：真ん中の大きな島と、まわりの小さな島
    const islets = [];
    if (skeleton === 'archipelago') {
        islets.push({ x: 0, z: 0, r: R * 0.55 });
        const n = ISLETS_MIN + Math.floor(rand() * (ISLETS_MAX - ISLETS_MIN + 1)) - 1;
        const start = rand() * Math.PI * 2;
        for (let i = 0; i < n; i++) {
            const a = start + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.6;
            const d = R * (0.65 + rand() * 0.25);
            islets.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: R * (0.28 + rand() * 0.14) });
        }
    }
    /** (x, z) の、海岸線までを 1 とした距離と、島の中心から見た向き */
    const where = (x, z) => {
        if (islets.length > 0) {
            let best = { d: Infinity, a: 0 };
            islets.forEach((c, i) => {
                const a = Math.atan2(z - c.z, x - c.x);
                const d = Math.hypot(x - c.x, z - c.z) / (c.r * coast(a + i * 1.7));
                if (d < best.d)
                    best = { d, a };
            });
            return best;
        }
        let px = x;
        let pz = z;
        if (skeleton === 'long') {
            const c = Math.cos(turn);
            const s = Math.sin(turn);
            px = (x * c + z * s) / LONG_X;
            pz = (-x * s + z * c) / LONG_Z;
        }
        const a = Math.atan2(pz, px);
        return { d: Math.hypot(px, pz) / (R * coast(a)), a };
    };
    /** 湖を掘る前の地面の高さ */
    const ground = (x, z) => {
        const { d, a } = where(x, z);
        let p = skeleton === 'flat' ? FLAT : skeleton === 'cliff' ? STEEP : SLOPE;
        // 崖の島は、1つの向きだけ坂になっていて上がれる。ほかの島は、切り立つ岸があれば1つの向きだけ崖になる
        const toward = Math.cos(a - sideA);
        if (skeleton === 'cliff')
            p = mix(STEEP, { ...SLOPE, top: STEEP.top }, smooth(toward, LANDING_WIDE, 0.95));
        else if (has('cliff'))
            p = mix(p, { ...STEEP, top: p.top + 4 }, smooth(toward, CLIFF_WIDE, 0.85));
        const top = p.top + (has('beach') ? BEACH_LIFT : 0);
        let land = 1 - smooth(d, p.inner, p.outer);
        // 入り江：湾の円の中を海にする
        if (skeleton === 'cove') {
            const bay = Math.hypot(x - Math.cos(bayA) * R * BAY_AT, z - Math.sin(bayA) * R * BAY_AT) / (R * BAY_R);
            land *= smooth(bay, 0.85, 1.2);
        }
        let h = SEA_FLOOR + land * top + land * land * fbm(x * 0.03 + noiseX, z * 0.03 + noiseZ) * BUMPS;
        if (skeleton === 'mountain') {
            const m = Math.hypot(x - mountX, z - mountZ) / (R * MOUNT_SPREAD);
            h += land * MOUNT_H * Math.exp(-m * m) * (1 + fbm(x * 0.08 + noiseZ, z * 0.08 + noiseX) * 0.25);
        }
        // 白い渚：海岸の低い所を平たくして、砂浜を広げる
        if (has('beach') && h > BEACH_LOW)
            h = h < BEACH_HIGH ? BEACH_LOW + (h - BEACH_LOW) * BEACH_FLAT : h - (BEACH_HIGH - BEACH_LOW) * (1 - BEACH_FLAT);
        return h;
    };
    // 空を映す水：まわりが十分高い所を探して、くぼみを掘る（見つからなければ湖はできない）
    let lake = null;
    if (has('lake')) {
        const reach = islets.length > 0 ? islets[0].r : R;
        for (let i = 0; i < LAKE_TRIES && !lake; i++) {
            const a = rand() * Math.PI * 2;
            const dist = rand() * reach * 0.5;
            const c = { x: Math.cos(a) * dist, z: Math.sin(a) * dist, r: LAKE_R_MIN + rand() * (LAKE_R_MAX - LAKE_R_MIN) };
            const rimOk = Array.from({ length: 12 }, (_, k) => (k / 12) * Math.PI * 2).every((b) => ground(c.x + Math.cos(b) * c.r * 1.3, c.z + Math.sin(b) * c.r * 1.3) > LAKE_RIM);
            if (ground(c.x, c.z) > LAKE_GROUND && rimOk)
                lake = c;
        }
    }
    const raw = (x, z) => {
        const h = ground(x, z);
        if (!lake)
            return h;
        const q = Math.hypot(x - lake.x, z - lake.z) / lake.r;
        if (q >= 1)
            return h;
        return Math.min(h, LAKE_DEPTH + (h - LAKE_DEPTH) * smooth(q, 0.55, 1));
    };
    return { skeleton, field: new HeightField(raw), radius: R, lake };
}
const smooth = (v, a, b) => {
    const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
};
function mix(p, q, k) {
    return { inner: p.inner + (q.inner - p.inner) * k, outer: p.outer + (q.outer - p.outer) * k, top: p.top + (q.top - p.top) * k };
}
