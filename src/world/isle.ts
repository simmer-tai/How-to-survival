import { HeightField, SEA_FLOOR, fbm } from './terrain.js';
import { chartRandom, type IslandChart } from '../items/islandChart.js';
import { CLEAR, DRY_PAD, MOUTH, ROOF_PAD, ROOM_JOIN, TUBE_TOP, alongPath, caveDry, caveHole, caveLocal, domeQ, domeRadius, domeReach, domeSpan, domeTop, nearBox, type Blob, type Cave, type Dome, type DomeShape, type Tunnel, type Wave } from './cave.js';

// 島の地図から海図に載せた島の、地面の形。島の地図の種（seed）と、本当に島にある地形（lands）から、いつも同じ形に作る。
// 島の形（骨格）は種からランダムに選ぶ（メモでは決められない）。地面の形に関わる地形（白い渚・空を映す水・切り立つ岸）もここで作る。
// どの島にも、斜面に洞窟が1つできる（置ける所がなければできない。空洞があれば数が増え、大きくなる）。
// 洞窟は地面にあいた穴（下り坂の溝）から、トンネルが地下へ続き、地下の部屋に出る。部屋からはさらにトンネルが枝分かれして、
// より深い部屋へ続く（海面より深くまで）。管と殻の形は world/cave.ts
// 木・茂み・岩の置き方は world/props.ts の buildIsleProps

/** 島の形（骨格） */
export type Skeleton = 'gentle' | 'mountain' | 'flat' | 'long' | 'cove' | 'cliff' | 'archipelago';
const SKELETONS: Skeleton[] = ['gentle', 'mountain', 'flat', 'long', 'cove', 'cliff', 'archipelago'];

/** 海図に載せた島の場所の広さ（m）。自分の島・街（WORLD_SIZE）より広い */
export const ISLE_SIZE = 300;
const RADIUS_MIN = 80; // 島の大きさ（中心から海岸線まで）の最小（m）。船は中心から 132m の沖に着くので、陸は中心から 124m の内側に収める
const RADIUS_MAX = 100;
const COAST_WOBBLE = 0.22; // 海岸線のでこぼこの大きさ（島の大きさに対する割合）
// 海岸線の入り組み：ノイズで海岸線までの距離を伸び縮みさせて、岬や小さな湾を作る
const COAST_NOISE = 0.3; // 大きなうねりの強さ（島の大きさに対する割合）
const COAST_FREQ = 0.012; // 大きなうねりの細かさ（1m あたり）
const COAST_FINE = 0.08; // 細かいでこぼこの強さ
const COAST_FINE_FREQ = 0.05;
const LAND_LIMIT = 124; // 陸はかならず中心からこの距離の内側に収める（船は 132m の沖に着く）
// 陸の起伏：丘・尾根と谷・島全体の傾き。海岸の近くでは弱めて、海岸線の形を変えない
const HILLS_MIN = 2; // 丘の数
const HILLS_MAX = 6;
const HILL_H = { min: 3, max: 10 }; // 丘の高さ（m）
const HILL_R = { min: 0.12, max: 0.3 }; // 丘の広がり（島の大きさに対する割合）
const RIDGE_H = 6; // 尾根と谷の高さの差（m）
const RIDGE_FREQ = 0.022; // 尾根と谷の細かさ（1m あたり）
const TILT_H = 5; // 島全体の傾き（中心から海岸線までで上がる高さ、m）
const RELIEF_FLAT = 0.35; // 凪の平（平たい島）は起伏をこれだけに弱める
const VALLEY_FLOOR = 1.2; // 谷の底の高さの下限（m）。もとの地面がこれより低い所はそのまま
// 沖の小島（群島のほかの島にも、ときどき出る）
const ROCKLETS_MAX = 3;
const ROCKLET_R = { min: 6, max: 12 }; // 小島の大きさ（m）
const ROCKLET_OUT = { min: 1.05, max: 1.2 }; // 小島の、中心からの距離（島の大きさに対する割合）
const BUMPS = 0.8; // 陸の小さな起伏の大きさ（m）
// ふつうの島の斜面：島の中心から海岸線までを 1 としたとき、高台から海底まで下る範囲と、高台の高さ（海底から）
const SLOPE = { inner: 0.55, outer: 1.3, top: 8.5 };
const FLAT = { inner: 0.7, outer: 1.2, top: 7.6 }; // 凪の平（平たい島）：低く、なだらか
const STEEP = { inner: 0.9, outer: 1.04, top: 12 }; // 拒む壁（崖の島）・切り立つ岸：高く、まっすぐ落ちる
const MOUNT_H = 20; // 天を衝く峰（山の島）の山の高さ（m）
const MOUNT_SPREAD = 0.42; // 山のすその広がり（島の大きさに対する割合）
const LONG_X = 1.3; // 竜の背（細長い島）の、長いほうの伸ばし方
const LONG_Z = 0.75; // 短いほうの縮め方
const LONG_SHRINK = 0.8; // 竜の背は島の大きさをこれだけ小さくしてから伸ばす（長いほうの端が中心から 124m を超えないように）
const BAY_AT = 0.6; // 三日月の懐（入り江の島）：湾の中心の、島の中心からの距離（島の大きさに対する割合）
const BAY_R = 0.62; // 湾の大きさ（島の大きさに対する割合）
const LANDING_WIDE = 0.75; // 崖の島で、上がれる坂になっている向きの広さ（向きの cos がこれより大きい所）
const CLIFF_WIDE = 0.55; // ほかの島の、切り立つ岸になっている向きの広さ
const ISLETS_MIN = 3; // 散らばる飛び石（群島）の島の数
const ISLETS_MAX = 5;
const ISLETS_OUT = { min: 0.6, max: 0.8 }; // まわりの小さな島の、中心からの距離（島の大きさに対する割合。外の島の端が 124m を超えないように）
// 白い渚：海岸の、この高さの範囲を平たくつぶして砂浜を広げる
const BEACH_LOW = 0.3;
const BEACH_HIGH = 2.4;
const BEACH_FLAT = 0.4; // つぶしたあとの傾きの割合
const BEACH_LIFT = 1.4; // つぶした分、島全体を高くしておく（高台が低くなりすぎないように）
// 空を映す水：島の中のくぼみ。海面より低いので、海と同じ水面が張る
const LAKE_R_MIN = 12;
const LAKE_R_MAX = 22;
const LAKE_DEPTH = -1.8; // 湖の底の高さ
const LAKE_TRIES = 40; // 湖を置ける所が見つかるまで試す回数
const LAKE_GROUND = 1.5; // 湖の中心の、もとの地面の高さの下限
const LAKE_RIM = 0.8; // 湖のまわり（岸の少し外）の、もとの地面の高さの下限（海とつながらないように）
// 洞窟：どの島にも1つ。空洞があると数が増え、大きくなる
const CAVES = 1;
const HOLLOW_CAVES = 2; // 空洞があるとき、足す数
const HOLLOW_SCALE = 1.3; // 空洞があるときの大きさの倍率
const CAVE_A = { min: 8, max: 10 }; // 穴のまわりの平らにならす範囲の、奥行きの半分（m）
const CAVE_B = { min: 5, max: 7 }; // 幅の半分（m）
const CAVE_TRIES = 300; // 洞窟を置ける所が見つかるまで試す回数
const CAVE_REACH = 0.5; // 穴を探す範囲（島の大きさに対する割合。地下の部屋とトンネルが陸の下に広がれるよう、内側に寄せる）
const CAVE_GROUND = 2.5; // 穴の、もとの地面の高さの下限（高い所の斜面に置く）
const CAVE_RIM = 1.0; // 穴のまわりの、もとの地面の高さの下限（海や湖にかからないように）
const CAVE_FLOOR = 1.5; // 穴のまわりの地面の高さの下限
const CAVE_FLAT = 1.0; // 地面を平らにする範囲（ならす範囲の大きさに対する割合）
const CAVE_BAND = 1.6; // 平らな所のふちから、もとの地面へなじませる範囲（ならす範囲の大きさに対する割合）
const CAVE_BOTTOM = -18; // 洞窟の床の高さの下限（m）。洞窟の上では海の水を消すので、海面より深くまで掘れる
// 地下へ続くトンネルと地下の部屋
const TUNNEL_W = 2.4; // 幅の半分（m）
const TUNNEL_H = 3.6; // 高さ（m）
const TUNNEL_STEP = 2; // 道すじの点の間隔（m）
const TUNNEL_START = 0.5; // 溝の始まり（ならす範囲の中心から坂の下の側へ、奥行きの半分に対する割合）
const TUNNEL_LEN = { min: 30, max: 46 }; // 入口のトンネルの、溝の始まりから最初の部屋までの長さ（m）
const RAMP = 0.4; // 下り坂の傾き（1m 進むと下がる高さ。約22度）
const TUNNEL_DROP = 14; // 入口のトンネルが、広間の床から下がる深さの最大（m）
const TRENCH_ROOF = 0.3; // 溝が終わってトンネルになる所の、天井の上の地面の厚さ（m）
const TUNNEL_TURN = 0.35; // 1歩ごとに曲がれる角度（rad）。入口のトンネルは高い地面の下へ向かうほうを選ぶ
const TUNNEL_SPREAD = 1.2; // 入口のトンネルが、広間の奥の向きから、それていける角度（rad）
const TRENCH_FLAT = 3.5; // 溝の縁の外を、さらにこれだけ平らにする（m）。地面のマス（約2.2m）の三角形が縁にかかっても傾かないように
const TRENCH_BLEND = 5; // 平らにした所から、もとの地面へなじませる幅（m）
const ROOF = 1.2; // トンネルと地下の部屋の天井の上に盛る地面の厚さ（m）
const ROOF_BLEND = 5; // 盛った地面を、もとの地面へなじませる幅（m）
const ROOM_A = { min: 8, max: 20 }; // 地下の部屋の奥行きの半分（m）
const ROOM_FLAT = { min: 0.7, max: 1 }; // 幅の半分の、奥行きの半分に対する割合
// 地下の部屋の種類。部屋ごとにランダムに選ぶ。size は大きさの倍率、tall は天井の高さの、狭いほうの幅の半分に対する割合
// （1 より小さいと横に広い部屋。細く高い部屋は、見上げると先のとがった塔の中のように見えるので、縦穴だけにする）、
// lobes は向きによる広さの伸び縮みの大きさ（合計）、roof は形の角の丸み（2 で楕円、大きいほど天井が平らで壁が切り立つ）、
// rough は壁を削るノイズの強さの倍率、blobs は重ねる小部屋の数、drips は鍾乳石の数
const ROOM_KINDS: {
  weight: number;
  size: number;
  tall: { min: number; max: number };
  lobes: number;
  roof: { min: number; max: number };
  rough: number;
  blobs: { min: number; max: number };
  drips: { min: number; max: number };
}[] = [
  { weight: 3, size: 1, tall: { min: 0.55, max: 0.8 }, lobes: 0.2, roof: { min: 2, max: 2.6 }, rough: 1, blobs: { min: 1, max: 2 }, drips: { min: 4, max: 10 } }, // ふつうの洞
  { weight: 2, size: 1.2, tall: { min: 0.35, max: 0.5 }, lobes: 0.18, roof: { min: 3.5, max: 5 }, rough: 0.8, blobs: { min: 2, max: 3 }, drips: { min: 12, max: 26 } }, // 天井の平たい広間（鍾乳石が多い）
  { weight: 1, size: 0.8, tall: { min: 1.1, max: 1.5 }, lobes: 0.15, roof: { min: 3, max: 4.5 }, rough: 1.2, blobs: { min: 0, max: 1 }, drips: { min: 3, max: 8 } }, // 天井の高い縦穴（壁が切り立ち、天井は平ら）
  { weight: 2, size: 1, tall: { min: 0.5, max: 0.75 }, lobes: 0.34, roof: { min: 2, max: 3 }, rough: 1.5, blobs: { min: 2, max: 4 }, drips: { min: 6, max: 14 } }, // 入り組んだ岩屋
  { weight: 1, size: 1.6, tall: { min: 0.45, max: 0.65 }, lobes: 0.3, roof: { min: 2.2, max: 3.2 }, rough: 1.3, blobs: { min: 3, max: 5 }, drips: { min: 25, max: 45 } }, // 大空洞
];
const ROOM_SMALLEST = 6.5; // 部屋の奥行き・幅の半分の最小（m。トンネルの口より十分広く）
const ROOM_H = { min: 5.5, max: 18 }; // 天井の高さ（m）
// 部屋に重ねる小部屋（でっぱった奥まりや、天井の高い所を作る）。どれも部屋の狭いほうの幅の半分に対する割合
const BLOB_AT = { min: 0.25, max: 0.5 }; // 部屋の中心から小部屋の中心までの距離
const BLOB_SIZE = { min: 0.3, max: 0.45 }; // 小部屋の大きさ（奥行き・幅の半分）
const BLOB_TALL = { min: 0.6, max: 1.15 }; // 小部屋の天井の高さ（部屋の高さに対する割合）
const LIFTED_FLOOR = 6.3; // 置ける所のない低い島では、穴のまわりをここまで持ち上げて丘にする
const UNDER_LAND = 1.0; // トンネルと部屋の上の、もとの地面の高さの下限（海や湖の下は通らない）
// 部屋から枝分かれするトンネル
const BRANCHES = { min: 3, max: 5 }; // 1つの洞窟に足す部屋の数（入口のトンネルの先の部屋のほか）
const HOLLOW_BRANCHES = 2; // 空洞があるとき、さらに足す数
const BRANCH_TRIES = 400; // 枝分かれを試す回数
const BRANCH_LEN = { min: 14, max: 32 }; // 枝のトンネルの、部屋を出てから次の部屋に入るまでの曲がりくねる部分の長さ（m）
const BRANCH_DROP = { min: 1, max: 9 }; // 枝の先の部屋が、元の部屋より下がる深さ（m）
const BRANCH_TURN = 0.3; // 枝のトンネルが1歩ごとに曲がる角度の最大（rad）
const BRANCH_LOOK = 10; // 枝のトンネルが、どれだけ先の地面の高さを見て曲がる向きを選ぶか（m）
const BRANCH_GROUND = 5; // 先の地面がこれより高ければ、どこも同じとみなす（m。陸の内側なら気ままに曲がる）
const BRANCH_WANDER = 4; // 曲がる向きを選ぶときの気まぐれの大きさ
const BRANCH_SHORT = 0.6; // 枝のトンネルが陸の端で止まったとき、曲がりくねる部分がこれだけ（BRANCH_LEN.min に対する割合）あれば、そこに部屋を置く
const BRANCH_ROOM_SHRINK = [1, 0.75, 0.6]; // 枝の先の部屋が入らないとき、順に小さくして試す倍率
const OPEN_GAP = 1.75; // 1つの部屋の口どうしの向きの差の最小（rad、約100度。部屋の前の壁がほかの口をふさがないように）
const OPEN_MAX = 3; // 1つの部屋の口の数の最大
const KEEP_H = 3; // ぶつからないとみなす、トンネル・部屋どうしの上下のすきま（m）
const KEEP_SIDE = 3; // 横のすきま（m）

/** 島の地面と、地形を置いた場所 */
export interface IsleShape {
  skeleton: Skeleton;
  field: HeightField;
  /** 島の中心（群島ならいちばん大きい島の中心）と大きさ。木や岩を置く範囲のめやす */
  radius: number;
  /** 空を映す水（湖）。置ける所がなければ null */
  lake: { x: number; z: number; r: number } | null;
  /** 洞窟（置ける所がなければ空） */
  caves: Cave[];
}

/** 島の地図の中身から、島の地面を作る */
export function isleShape(chart: IslandChart): IsleShape {
  const rand = chartRandom(chart.seed + 3);
  const has = (k: string) => (chart.lands as string[]).includes(k);
  const skeleton = SKELETONS[Math.floor(rand() * SKELETONS.length)];
  const R = (RADIUS_MIN + rand() * (RADIUS_MAX - RADIUS_MIN)) * (skeleton === 'long' ? LONG_SHRINK : 1);
  const waves = [2, 3, 5, 7].map((k) => ({ k, amp: rand(), phase: rand() * Math.PI * 2 }));
  const ampSum = waves.reduce((n, w) => n + w.amp, 0) || 1;
  /** 向き a の海岸線までの距離（1 がふつう） */
  const coast = (a: number) => 1 + (COAST_WOBBLE * waves.reduce((n, w) => n + w.amp * Math.sin(w.k * a + w.phase), 0)) / ampSum;
  const noiseX = rand() * 100;
  const noiseZ = rand() * 100;
  const turn = rand() * Math.PI; // 細長い島の向き
  const bayA = rand() * Math.PI * 2; // 入り江の湾の向き
  const sideA = rand() * Math.PI * 2; // 崖の島の上がれる向き・切り立つ岸の向き
  const mountX = (rand() - 0.5) * R * 0.3;
  const mountZ = (rand() - 0.5) * R * 0.3;
  // 群島：真ん中の大きな島と、まわりの小さな島
  const islets: { x: number; z: number; r: number }[] = [];
  if (skeleton === 'archipelago') {
    islets.push({ x: 0, z: 0, r: R * 0.55 });
    const n = ISLETS_MIN + Math.floor(rand() * (ISLETS_MAX - ISLETS_MIN + 1)) - 1;
    const start = rand() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.6;
      const d = R * (ISLETS_OUT.min + rand() * (ISLETS_OUT.max - ISLETS_OUT.min));
      islets.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: R * (0.28 + rand() * 0.14) });
    }
  }
  const coastX = rand() * 100;
  const coastZ = rand() * 100;
  const ridgeX = rand() * 100;
  const ridgeZ = rand() * 100;
  const tiltA = rand() * Math.PI * 2;
  const hills = Array.from({ length: HILLS_MIN + Math.floor(rand() * (HILLS_MAX - HILLS_MIN + 1)) }, () => {
    const a = rand() * Math.PI * 2;
    const d = rand() * R * 0.7;
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, r: R * (HILL_R.min + rand() * (HILL_R.max - HILL_R.min)), h: HILL_H.min + rand() * (HILL_H.max - HILL_H.min) };
  });
  // 沖の小島：海岸線のすぐ外に、岩がちな小さな島
  const rocklets = Array.from({ length: skeleton === 'archipelago' ? 0 : Math.floor(rand() * (ROCKLETS_MAX + 1)) }, () => {
    const a = rand() * Math.PI * 2;
    const d = Math.min(R * (ROCKLET_OUT.min + rand() * (ROCKLET_OUT.max - ROCKLET_OUT.min)), LAND_LIMIT - 16);
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, r: ROCKLET_R.min + rand() * (ROCKLET_R.max - ROCKLET_R.min) };
  });
  /** 海岸線の入り組み（1 より大きいと海岸線が外へ張り出す） */
  const reach = (x: number, z: number) =>
    1 + COAST_NOISE * fbm(x * COAST_FREQ + coastX, z * COAST_FREQ + coastZ) + COAST_FINE * fbm(x * COAST_FINE_FREQ + coastZ, z * COAST_FINE_FREQ + coastX);

  /** (x, z) の、海岸線までを 1 とした距離と、島の中心から見た向き。沖の小島も合わせる */
  const where = (x: number, z: number): { d: number; a: number } => {
    const main = body(x, z);
    const d = main.d / reach(x, z);
    let best = { d, a: main.a };
    for (const c of rocklets) {
      const q = Math.hypot(x - c.x, z - c.z) / c.r;
      if (q < best.d) best = { d: q, a: Math.atan2(z - c.z, x - c.x) };
    }
    return best;
  };

  /** 島の本体（骨格の形）の、海岸線までを 1 とした距離と向き */
  const body = (x: number, z: number): { d: number; a: number } => {
    if (islets.length > 0) {
      let best = { d: Infinity, a: 0 };
      islets.forEach((c, i) => {
        const a = Math.atan2(z - c.z, x - c.x);
        const d = Math.hypot(x - c.x, z - c.z) / (c.r * coast(a + i * 1.7));
        if (d < best.d) best = { d, a };
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
  const ground = (x: number, z: number): number => {
    const { d, a } = where(x, z);
    let p = skeleton === 'flat' ? FLAT : skeleton === 'cliff' ? STEEP : SLOPE;
    // 崖の島は、1つの向きだけ坂になっていて上がれる。ほかの島は、切り立つ岸があれば1つの向きだけ崖になる
    const toward = Math.cos(a - sideA);
    if (skeleton === 'cliff') p = mix(STEEP, { ...SLOPE, top: STEEP.top }, smooth(toward, LANDING_WIDE, 0.95));
    else if (has('cliff')) p = mix(p, { ...STEEP, top: p.top + 4 }, smooth(toward, CLIFF_WIDE, 0.85));
    const top = p.top + (has('beach') ? BEACH_LIFT : 0);
    let land = 1 - smooth(d, p.inner, p.outer);
    // 入り江：湾の円の中を海にする
    if (skeleton === 'cove') {
      const bay = Math.hypot(x - Math.cos(bayA) * R * BAY_AT, z - Math.sin(bayA) * R * BAY_AT) / (R * BAY_R);
      land *= smooth(bay, 0.85, 1.2);
    }
    land *= 1 - smooth(Math.hypot(x, z), LAND_LIMIT - 14, LAND_LIMIT);
    let h = SEA_FLOOR + land * top + land * land * fbm(x * 0.03 + noiseX, z * 0.03 + noiseZ) * BUMPS;
    // 起伏：丘・尾根と谷・島全体の傾き（海岸の近くでは弱める）
    const inland = land * (1 - smooth(d, 0.35, 0.85)) * (skeleton === 'flat' ? RELIEF_FLAT : 1);
    if (inland > 0) {
      let relief = (TILT_H * (x * Math.cos(tiltA) + z * Math.sin(tiltA))) / R;
      for (const k of hills) {
        const q = Math.hypot(x - k.x, z - k.z) / k.r;
        relief += k.h * Math.exp(-q * q);
      }
      const rg = 1 - Math.min(Math.abs(fbm(x * RIDGE_FREQ + ridgeX, z * RIDGE_FREQ + ridgeZ)) * 2, 1);
      relief += RIDGE_H * (rg * rg - 0.4);
      h = Math.max(h + inland * relief, Math.min(h, VALLEY_FLOOR)); // 谷が海面より下まで掘れて、島の中に海の水たまりができないように
    }
    if (skeleton === 'mountain') {
      const m = Math.hypot(x - mountX, z - mountZ) / (R * MOUNT_SPREAD);
      h += land * MOUNT_H * Math.exp(-m * m) * (1 + fbm(x * 0.08 + noiseZ, z * 0.08 + noiseX) * 0.25);
    }
    // 白い渚：海岸の低い所を平たくして、砂浜を広げる
    if (has('beach') && h > BEACH_LOW) h = h < BEACH_HIGH ? BEACH_LOW + (h - BEACH_LOW) * BEACH_FLAT : h - (BEACH_HIGH - BEACH_LOW) * (1 - BEACH_FLAT);
    return h;
  };

  // 空を映す水：まわりが十分高い所を探して、くぼみを掘る（見つからなければ湖はできない）
  let lake: IsleShape['lake'] = null;
  if (has('lake')) {
    const reach = islets.length > 0 ? islets[0].r : R;
    for (let i = 0; i < LAKE_TRIES && !lake; i++) {
      const a = rand() * Math.PI * 2;
      const dist = rand() * reach * 0.5;
      const c = { x: Math.cos(a) * dist, z: Math.sin(a) * dist, r: LAKE_R_MIN + rand() * (LAKE_R_MAX - LAKE_R_MIN) };
      const rimOk = Array.from({ length: 12 }, (_, k) => (k / 12) * Math.PI * 2).every(
        (b) => ground(c.x + Math.cos(b) * c.r * 1.3, c.z + Math.sin(b) * c.r * 1.3) > LAKE_RIM,
      );
      if (ground(c.x, c.z) > LAKE_GROUND && rimOk) lake = c;
    }
  }

  /** 洞窟の床をならす前の地面の高さ */
  const withLake = (x: number, z: number): number => {
    const h = ground(x, z);
    if (!lake) return h;
    const q = Math.hypot(x - lake.x, z - lake.z) / lake.r;
    if (q >= 1) return h;
    return Math.min(h, LAKE_DEPTH + (h - LAKE_DEPTH) * smooth(q, 0.55, 1));
  };

  /** 地面の上か（海・湖の上でなく、島の端から離れている） */
  const overLand = (x: number, z: number) =>
    withLake(x, z) > UNDER_LAND && Math.hypot(x, z) < LAND_LIMIT - 20 && (!lake || Math.hypot(x - lake.x, z - lake.z) > lake.r + TUNNEL_W + 4);
  /** (x, z) と、そのまわり（半径 r）が地面の上か（洞窟の上で海の水を消す所が、見える海にかからないように） */
  const landAround = (x: number, z: number, r: number) =>
    overLand(x, z) && Array.from({ length: 8 }, (_, k) => (k / 8) * Math.PI * 2).every((u) => overLand(x + Math.cos(u) * r, z + Math.sin(u) * r));
  /** 部屋のまわりが地面の上か */
  const roomOnLand = (r: Dome) =>
    overLand(r.x, r.z) &&
    Array.from({ length: 16 }, (_, k) => (k / 16) * Math.PI * 2).every((u) => {
      const d = domeReach(r, u) + DRY_PAD + 2;
      return overLand(r.x + Math.cos(u) * d, r.z + Math.sin(u) * d);
    });
  const TUBE_PAD = TUNNEL_W + DRY_PAD + 1.5;

  // 掘った洞窟の物（ほかの物とぶつからないように調べる）
  const halls: Dome[] = [];
  const rooms: Dome[] = [];
  const tubes: Tunnel['pts'][] = [];
  const span = (r: Dome) => domeSpan(r);
  const apart = (y0: number, y1: number, z0: number, z1: number) => y1 + KEEP_H <= z0 || z1 + KEEP_H <= y0;
  /** トンネルの床の点 p が、掘った物とぶつからないか（skip の部屋は調べない） */
  const tubeFree = (p: Tunnel['pts'][number], skip?: Dome) =>
    halls.every((h) => domeQ(h, p.x, p.z) > 1.7) &&
    rooms.every((r) => r === skip || domeQ(r, p.x, p.z) > 1.6 || apart(p.y, p.y + TUNNEL_H, r.floor, r.floor + domeTop(r))) &&
    tubes.every((t) => t.every((q) => Math.hypot(p.x - q.x, p.z - q.z) > TUNNEL_W * 2 + KEEP_SIDE || Math.abs(p.y - q.y) > TUNNEL_H + KEEP_H));
  /** 部屋 r が、掘った物とぶつからないか */
  const roomFree = (r: Dome) =>
    halls.every((h) => Math.hypot(h.x - r.x, h.z - r.z) > (span(h) + span(r)) * 1.4) &&
    rooms.every((o) => Math.hypot(o.x - r.x, o.z - r.z) > (span(o) + span(r)) * 1.15 + KEEP_SIDE || apart(r.floor, r.floor + domeTop(r), o.floor, o.floor + domeTop(o))) &&
    tubes.every((t) => t.every((q) => domeQ(r, q.x, q.z) > 1.6 || apart(q.y, q.y + TUNNEL_H, r.floor, r.floor + domeTop(r))));

  /** 地下の部屋を、口の向き（中心から見た世界の向き） ang の縁から ROOM_JOIN の所が end に来るように置く */
  const roomAt = (end: Tunnel['pts'][number], ang: number, scale: number): Dome => {
    let pick = rand() * ROOM_KINDS.reduce((n, k) => n + k.weight, 0);
    const kind = ROOM_KINDS.find((k) => (pick -= k.weight) < 0) ?? ROOM_KINDS[0];
    const a = Math.max((ROOM_A.min + rand() * (ROOM_A.max - ROOM_A.min)) * scale * kind.size, ROOM_SMALLEST);
    const b = Math.max(a * (ROOM_FLAT.min + rand() * (ROOM_FLAT.max - ROOM_FLAT.min)), ROOM_SMALLEST);
    const narrow = Math.min(a, b);
    const h = Math.min(Math.max(narrow * (kind.tall.min + rand() * (kind.tall.max - kind.tall.min)), ROOM_H.min), ROOM_H.max);
    const blobs: Blob[] = Array.from({ length: kind.blobs.min + Math.floor(rand() * (kind.blobs.max - kind.blobs.min + 1)) }, () => {
      const t = rand() * Math.PI * 2;
      const d = narrow * (BLOB_AT.min + rand() * (BLOB_AT.max - BLOB_AT.min));
      const size = () => narrow * (BLOB_SIZE.min + rand() * (BLOB_SIZE.max - BLOB_SIZE.min));
      return { l: Math.cos(t) * d, s: Math.sin(t) * d, a: size(), b: size(), h: h * (BLOB_TALL.min + rand() * (BLOB_TALL.max - BLOB_TALL.min)) };
    });
    const shape: DomeShape = {
      lobes: shapeWaves(kind.lobes),
      roof: kind.roof.min + rand() * (kind.roof.max - kind.roof.min),
      rough: kind.rough,
      blobs,
      drips: kind.drips.min + Math.floor(rand() * (kind.drips.max - kind.drips.min + 1)),
    };
    const r: Dome = { x: 0, z: 0, yaw: rand() * Math.PI * 2, a, b, h, floor: end.y, seed: Math.floor(rand() * 2 ** 30), shape };
    const d = domeRadius(r, ang) * ROOM_JOIN;
    r.x = end.x - Math.cos(ang) * d;
    r.z = end.z - Math.sin(ang) * d;
    // 天井が地面を大きく持ち上げないよう、上の地面に収まる高さまで低くする（小部屋も同じ割合で）
    const room = withLake(r.x, r.z) - CLEAR - ROOF - r.floor;
    const k = Math.max(ROOM_H.min / r.h, Math.min(1, room / domeTop(r)));
    r.h *= k;
    for (const bl of blobs) bl.h *= k;
    return r;
  };
  /** 大きさの合計が total になる、1周に2〜4回繰り返す波（形のゆがみ） */
  function shapeWaves(total: number): Wave[] {
    const list = [2, 3, 4, 5, 6].map((k) => ({ k, amp: rand() / Math.sqrt(k), phase: rand() * Math.PI * 2 })); // 細かい波ほど小さく
    const sum = list.reduce((n, w) => n + w.amp, 0) || 1;
    for (const w of list) w.amp *= total / sum;
    return list;
  }
  /** 道すじ pts を向き heading へ、平らなまま n 歩まっすぐ伸ばす */
  const straight = (pts: Tunnel['pts'], heading: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const p = pts[pts.length - 1];
      pts.push({ x: p.x + Math.cos(heading) * TUNNEL_STEP, z: p.z + Math.sin(heading) * TUNNEL_STEP, y: p.y });
    }
  };
  /** 部屋の口から縁の外まで、トンネルが平らにまっすぐ通る歩数（部屋の床とトンネルの床が食い違わないように） */
  const flatSteps = (r: Dome, ang: number) => Math.ceil((domeRadius(r, ang) * (1 - ROOM_JOIN) + 1.5) / TUNNEL_STEP);

  /** 穴 c から地下へ続く入口のトンネルと、最初の部屋を掘る道すじを決める（行けなければ null） */
  const dig = (c: Dome, scale: number): { tunnel: Tunnel; room: Dome } | null => {
    const bottom = Math.max(c.floor - TUNNEL_DROP, CAVE_BOTTOM);
    if (c.floor - bottom < TUNNEL_H + TRENCH_ROOF + 0.5) return null;
    const back = c.yaw + Math.PI;
    let heading = back;
    const start = { x: c.x + Math.cos(c.yaw) * c.a * TUNNEL_START, z: c.z + Math.sin(c.yaw) * c.a * TUNNEL_START, y: c.floor };
    const pts = [start];
    const len = TUNNEL_LEN.min + rand() * (TUNNEL_LEN.max - TUNNEL_LEN.min);
    let trench = -1;
    for (let d = TUNNEL_STEP; d <= len; d += TUNNEL_STEP) {
      const p = pts[pts.length - 1];
      // 平らな所の中はまっすぐ奥へ。出たら、上の地面が高いほうへ曲がりながら進む
      if (domeQ(c, p.x, p.z) > 1) {
        let best = { hd: heading, score: -Infinity };
        for (const turn of [-1, -0.5, 0, 0.5, 1]) {
          const hd = heading + turn * TUNNEL_TURN;
          if (Math.abs(Math.atan2(Math.sin(hd - back), Math.cos(hd - back))) > TUNNEL_SPREAD) continue;
          const score = withLake(p.x + Math.cos(hd) * TUNNEL_STEP * 3, p.z + Math.sin(hd) * TUNNEL_STEP * 3) + rand() * 2;
          if (score > best.score) best = { hd, score };
        }
        heading = best.hd;
      }
      const y = Math.max(bottom, p.y - RAMP * TUNNEL_STEP);
      pts.push({ x: p.x + Math.cos(heading) * TUNNEL_STEP, z: p.z + Math.sin(heading) * TUNNEL_STEP, y });
      if (trench < 0 && y + TUNNEL_H <= c.floor - TRENCH_ROOF) trench = pts.length - 1;
    }
    // 溝は平らな所の中で終わること
    if (trench < 0 || domeQ(c, pts[trench].x, pts[trench].z) > 0.9) return null;
    // 最初の部屋：トンネルの終わりが部屋の中（前の壁）に来るように置く。部屋の縁の内側はトンネルを平らにする
    const probe = roomAt(pts[pts.length - 1], heading + Math.PI, scale);
    straight(pts, heading, flatSteps(probe, heading + Math.PI));
    const last = pts[pts.length - 1];
    const shift = domeRadius(probe, heading + Math.PI) * ROOM_JOIN;
    const room: Dome = { ...probe, x: last.x + Math.cos(heading) * shift, z: last.z + Math.sin(heading) * shift, floor: last.y };
    // 広間を出たトンネルと部屋は陸の下を通り、ほかの洞窟とぶつからないこと
    const under = pts.filter((p) => domeQ(c, p.x, p.z) >= 0.9);
    if (!under.every((p) => landAround(p.x, p.z, TUBE_PAD) && tubeFree(p))) return null;
    if (!roomOnLand(room) || !roomFree(room)) return null;
    return { tunnel: { pts, w: TUNNEL_W, th: TUNNEL_H, trench, from: -1, to: 0 }, room };
  };

  /** 洞窟 cave の部屋 from から、より深い部屋へ続く枝のトンネルを掘る（掘れなければ false） */
  const branch = (cave: Cave, from: number, scale: number): boolean => {
    const P = cave.rooms[from];
    const used = cave.tunnels.flatMap((t) => [
      ...(t.to === from ? [t.pts[t.pts.length - 1]] : []),
      ...(t.from === from ? [t.pts[0]] : []),
    ]).map((p) => Math.atan2(p.z - P.z, p.x - P.x));
    if (used.length >= OPEN_MAX) return false;
    // 口の向き：ほかの口から離れた向きを選ぶ
    const gap = (ang: number) => Math.min(Math.PI, ...used.map((u) => Math.abs(Math.atan2(Math.sin(u - ang), Math.cos(u - ang)))));
    const ang = used.length === 0 ? rand() * Math.PI * 2 : used[0] + OPEN_GAP + rand() * (Math.PI * 2 - OPEN_GAP * 2);
    if (gap(ang) < OPEN_GAP) return false;
    const d = domeRadius(P, ang) * ROOM_JOIN;
    const pts: Tunnel['pts'] = [{ x: P.x + Math.cos(ang) * d, z: P.z + Math.sin(ang) * d, y: P.floor }];
    let heading = ang;
    // 部屋の縁の外までは平らにまっすぐ、そのあと2歩はまっすぐ下る
    straight(pts, heading, flatSteps(P, ang));
    const goal = Math.max(P.floor - BRANCH_DROP.min - rand() * (BRANCH_DROP.max - BRANCH_DROP.min), CAVE_BOTTOM);
    const len = BRANCH_LEN.min + rand() * (BRANCH_LEN.max - BRANCH_LEN.min);
    if (!landAround(pts[pts.length - 1].x, pts[pts.length - 1].z, TUBE_PAD)) return false;
    let k = 0;
    for (; k * TUNNEL_STEP < len; k++) {
      const p = pts[pts.length - 1];
      // 部屋を出て2歩のちは、曲がりくねりながら、上の地面が高い（陸の内側の）ほうへ進む
      if (k >= 2) {
        let best = { hd: heading, score: -Infinity };
        for (const turn of [-1, -0.5, 0, 0.5, 1]) {
          const hd = heading + turn * BRANCH_TURN;
          const ahead = withLake(p.x + Math.cos(hd) * BRANCH_LOOK, p.z + Math.sin(hd) * BRANCH_LOOK);
          const score = Math.min(ahead, BRANCH_GROUND) + rand() * BRANCH_WANDER;
          if (score > best.score) best = { hd, score };
        }
        heading = best.hd;
      }
      const y = p.y + Math.max(-RAMP * TUNNEL_STEP, Math.min(RAMP * TUNNEL_STEP, goal - p.y));
      const q = { x: p.x + Math.cos(heading) * TUNNEL_STEP, z: p.z + Math.sin(heading) * TUNNEL_STEP, y };
      if (!landAround(q.x, q.z, TUBE_PAD)) break; // 陸の下から出そうなら、そこで部屋にする
      pts.push(q);
    }
    if (k * TUNNEL_STEP < BRANCH_LEN.min * BRANCH_SHORT) return false;
    // 部屋は入らなければ小さくする
    const ok = BRANCH_ROOM_SHRINK.some((shrink) => {
      const path = pts.slice();
      const probe = roomAt(path[path.length - 1], heading + Math.PI, scale * shrink);
      straight(path, heading, flatSteps(probe, heading + Math.PI));
      const last = path[path.length - 1];
      const shift = domeRadius(probe, heading + Math.PI) * ROOM_JOIN;
      const room: Dome = { ...probe, x: last.x + Math.cos(heading) * shift, z: last.z + Math.sin(heading) * shift, floor: last.y };
      // 元の部屋の近くの点は、元の部屋とそのほかの口とぶつかってよい
      const out = path.filter((p) => domeQ(P, p.x, p.z) > 1.6);
      if (!path.every((p) => landAround(p.x, p.z, TUBE_PAD))) return false;
      if (!out.every((p) => tubeFree(p, P))) return false;
      if (!roomOnLand(room) || !roomFree(room)) return false;
      // 新しい部屋が自分のトンネルの点とぶつかっていないか（部屋に入る最後の平らな部分のほか）
      const enter = flatSteps(room, heading + Math.PI) + 2;
      if (path.slice(0, -enter).some((q) => domeQ(room, q.x, q.z) < 1.6)) return false;
      pts.splice(0, pts.length, ...path);
      cave.rooms.push(room);
      rooms.push(room);
      return true;
    });
    if (!ok) return false;
    cave.tunnels.push({ pts, w: TUNNEL_W, th: TUNNEL_H, trench: 0, from, to: cave.rooms.length - 1 });
    tubes.push(pts);
    return true;
  };

  // 洞窟：高い所の斜面を探して平らにならし、坂の上へ向かって穴を下らせる。
  // 見つからなければ（低い島）、穴のまわりを持ち上げて丘にする
  const caves: Cave[] = [];
  const caveCount = CAVES + (has('hollow') ? HOLLOW_CAVES : 0);
  const scale = has('hollow') ? HOLLOW_SCALE : 1;
  const reachOut = (islets.length > 0 ? islets[0].r : R) * CAVE_REACH;
  for (let i = 0; i < CAVE_TRIES * 2 && caves.length < caveCount; i++) {
    const lift = i >= CAVE_TRIES;
    const t = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * reachOut;
    const x = Math.cos(t) * dist;
    const z = Math.sin(t) * dist;
    const a = (CAVE_A.min + rand() * (CAVE_A.max - CAVE_A.min)) * scale;
    const b = (CAVE_B.min + rand() * (CAVE_B.max - CAVE_B.min)) * scale;
    const seed = Math.floor(rand() * 2 ** 30);
    if (withLake(x, z) < CAVE_GROUND) continue;
    const gx = withLake(x + 3, z) - withLake(x - 3, z);
    const gz = withLake(x, z + 3) - withLake(x, z - 3);
    const yaw = Math.hypot(gx, gz) > 0.05 ? Math.atan2(-gz, -gx) : t; // 坂の下の向き（平らなら外向き）
    const c: Dome = { x, z, yaw, a, b, h: 0, floor: 0, seed };
    const at = (l: number, s: number) => withLake(x + l * Math.cos(yaw) - s * Math.sin(yaw), z + l * Math.sin(yaw) + s * Math.cos(yaw));
    c.floor = at(a, 0);
    if (c.floor < CAVE_FLOOR) continue;
    const rimOk = Array.from({ length: 16 }, (_, k) => (k / 16) * Math.PI * 2).every(
      (u) => at(Math.cos(u) * a * CAVE_BAND, Math.sin(u) * b * CAVE_BAND) > CAVE_RIM,
    );
    if (!rimOk) continue;
    if (halls.some((o) => Math.hypot(o.x - x, o.z - z) < o.a + a + 6)) continue;
    if (rooms.some((o) => domeQ(o, x, z) < 1.8)) continue;
    if (lift) c.floor = Math.max(c.floor, LIFTED_FLOOR);
    const under = dig(c, scale);
    if (!under) continue;
    const cave: Cave = { ...c, tunnels: [under.tunnel], rooms: [under.room] };
    caves.push(cave);
    halls.push(c);
    rooms.push(under.room);
    tubes.push(under.tunnel.pts);
    // 部屋から枝分かれして、より深い部屋へ
    const want = BRANCHES.min + Math.floor(rand() * (BRANCHES.max - BRANCHES.min + 1)) + (has('hollow') ? HOLLOW_BRANCHES : 0);
    for (let k = 0, added = 0; k < BRANCH_TRIES && added < want; k++) {
      // 新しい（深い）部屋ほど選ばれやすく
      const from = Math.min(Math.floor(Math.sqrt(rand()) * cave.rooms.length), cave.rooms.length - 1);
      if (branch(cave, from, scale)) added++;
    }
  }

  const raw = (x: number, z: number): number => {
    let h = withLake(x, z);
    for (const c of caves) {
      // 穴のまわりは平らにならし、ふちでもとの地面へなじませる
      const { l, s } = caveLocal(c, x, z);
      const q = Math.hypot(l / c.a, s / c.b);
      if (q < CAVE_BAND) h = c.floor + (h - c.floor) * smooth(q, CAVE_FLAT, CAVE_BAND);
      // 溝のまわりの縁（地面のすぐ下に張り出す）が、平らな所の外で地面から浮かないように、溝に沿っても平らにする
      const t = c.tunnels[0];
      const rim = Math.min(alongPath(t.pts, 0, Math.min(t.trench + 2, t.pts.length - 1), x, z).d, Math.hypot(x - t.pts[0].x, z - t.pts[0].z)); // 手前の縁は溝の始まりの点から
      const flat = t.w + MOUTH + TRENCH_FLAT;
      if (rim < flat + TRENCH_BLEND) h = c.floor + (h - c.floor) * smooth(rim, flat, flat + TRENCH_BLEND);
      // トンネルと地下の部屋の上は、天井より ROOF 高くなるまで地面を盛る（平らな所の中は、溝の上を抜くのでそのまま）
      if (q < CAVE_FLAT) continue;
      for (const tb of c.tunnels) {
        if (!nearBox(tb.pts, x, z, tb.w + ROOF_BLEND)) continue;
        const near = alongPath(tb.pts, tb.trench, tb.pts.length - 1, x, z);
        if (near.d < tb.w + ROOF_BLEND) h = cover(h, near.y + tb.th * TUBE_TOP + ROOF_PAD, smooth(near.d, tb.w + 1, tb.w + ROOF_BLEND));
      }
      for (const r of c.rooms) {
        const qr = Math.hypot(x - r.x, z - r.z) / domeReach(r, Math.atan2(z - r.z, x - r.x)); // 壁がいちばん外へ出た所を 1 とした距離
        if (qr < 1.8) h = cover(h, r.floor + domeTop(r) + CLEAR + ROOF, smooth(qr, 1.1, 1.8));
      }
    }
    return h;
  };

  const field: HeightField = new HeightField(raw, ISLE_SIZE, {
    hole: (x, z) => Math.max(-Infinity, ...caves.map((c) => caveHole(c, x, z, field.height(x, z)))), // 地面の頂点で調べるので、そこの高さはその頂点の高さ
    dry: (x, z) => caves.some((c) => caveDry(c, x, z)),
  });
  return { skeleton, field, radius: R, lake, caves };
}

/** 地面 h を、need より低ければ need まで盛る（k が 0 で need、1 でもとの高さ） */
const cover = (h: number, need: number, k: number): number => (h >= need ? h : need + (h - need) * k);

const smooth = (v: number, a: number, b: number): number => {
  const t = Math.min(Math.max((v - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

function mix(p: typeof SLOPE, q: typeof SLOPE, k: number): typeof SLOPE {
  return { inner: p.inner + (q.inner - p.inner) * k, outer: p.outer + (q.outer - p.outer) * k, top: p.top + (q.top - p.top) * k };
}
