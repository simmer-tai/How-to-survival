// 海の波。水面の見た目（シェーダー）と浮力・泳ぎ（CPU）で同じ式を使う

interface Wave {
  /** 進む向き（ラジアン、XZ平面） */
  angle: number;
  length: number;
  /** 山の高さ（平均水面から） */
  amp: number;
  speed: number;
  phase: number;
}

const WAVES: Wave[] = [
  { angle: 0.6, length: 26, amp: 0.2, speed: 2.4, phase: 0 },
  { angle: 2.0, length: 15, amp: 0.11, speed: 1.9, phase: 1.7 },
  { angle: -0.8, length: 9, amp: 0.06, speed: 1.5, phase: 4.1 },
  { angle: 1.3, length: 5.5, amp: 0.03, speed: 1.1, phase: 2.6 },
];

/** 遠くの粗いメッシュでは波を消す */
export const WAVE_FADE_START = 300;
export const WAVE_FADE_END = 380;

const coeffs = WAVES.map((w) => {
  const k = (2 * Math.PI) / w.length;
  return { kx: Math.cos(w.angle) * k, kz: Math.sin(w.angle) * k, omega: k * w.speed, amp: w.amp, phase: w.phase };
});

let time = 0;
/** 波の高さの倍率（天気で変わる。シェーダーにも同じ値を渡す） */
export const waveScale = { value: 1 };

/** 毎フレーム経過時間を渡す */
export function setWaveTime(t: number): void {
  time = t;
}

/** 波の高さの倍率を変える（嵐で高くなる） */
export function setWaveScale(k: number): void {
  waveScale.value = k;
}

// 山はとがらせ、谷は広くする（平均が0になるようにずらす）
const crest = (x: number) => {
  const s = 0.5 + 0.5 * Math.sin(x);
  return (s * s - 0.375) * 2;
};

/** 平均水面からの高さ */
export function waveOffset(x: number, z: number): number {
  let h = 0;
  for (const c of coeffs) h += c.amp * crest(x * c.kx + z * c.kz - time * c.omega + c.phase);
  const r = Math.hypot(x, z);
  const t = Math.min(Math.max((r - WAVE_FADE_START) / (WAVE_FADE_END - WAVE_FADE_START), 0), 1);
  return h * waveScale.value * (1 - t * t * (3 - 2 * t));
}

const f = (n: number) => n.toFixed(6);

/** waveOffset と同じ計算の GLSL（使うシェーダーには uWaveScale に waveScale を渡す） */
export const WAVE_GLSL = /* glsl */ `
uniform float uWaveScale;
float waveCrest(float x) {
  float s = 0.5 + 0.5 * sin(x);
  return (s * s - 0.375) * 2.0;
}
float waveOffset(vec2 p, float t) {
  float h = 0.0;
${coeffs
  .map((c) => `  h += ${f(c.amp)} * waveCrest(dot(p, vec2(${f(c.kx)}, ${f(c.kz)})) - t * ${f(c.omega)} + ${f(c.phase)});`)
  .join('\n')}
  return h * uWaveScale * (1.0 - smoothstep(${f(WAVE_FADE_START)}, ${f(WAVE_FADE_END)}, length(p)));
}
`;
