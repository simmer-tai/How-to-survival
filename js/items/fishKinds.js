import { PALETTE } from '../core/palette.js';
// 釣れる魚の種類。見た目（itemModels.ts の buildFishModel）・釣れる場所と時間・引きの強さをここにまとめる。
// 釣りは自分だけの行動なので、どの魚がかかるかは各自のブラウザで Math.random() を使って決めてよい
export const FISH_IDS = ['fish', 'clownfish', 'snapper', 'puffer', 'flounder', 'bonito'];
export const FISH_KINDS = {
    // いちばんよく釣れる。銀色の細い体
    fish: {
        name: 'アジ', rarity: 1, sizeCm: [16, 30],
        length: 0.42, height: 0.3, width: 0.17, fat: 0.4,
        back: PALETTE.water, belly: PALETTE.sky, fin: PALETTE.sky, pattern: 'stripes', patternColor: PALETTE.sand, tail: 'fork', dorsal: 0.8,
        depth: [0.6, 99], weight: 10, time: 'any', power: 1, patience: 1,
    },
    // 浅い所の昼だけ。オレンジに白い縦じま
    clownfish: {
        name: 'クマノミ', rarity: 2, sizeCm: [8, 12],
        length: 0.3, height: 0.42, width: 0.22, fat: 0.4,
        back: PALETTE.accent, belly: PALETTE.accent, fin: PALETTE.accent, pattern: 'bands', patternColor: PALETTE.sand, tail: 'round', dorsal: 1,
        depth: [0.6, 2.5], weight: 4, time: 'day', power: 0.7, patience: 1.2,
    },
    // 少し深い所。赤くて体高があり、青い点がある
    snapper: {
        name: 'マダイ', rarity: 2, sizeCm: [30, 60],
        length: 0.46, height: 0.46, width: 0.2, fat: 0.35,
        back: PALETTE.accent, belly: PALETTE.sand, fin: PALETTE.accent, pattern: 'spots', patternColor: PALETTE.sky, tail: 'fork', dorsal: 1.3,
        depth: [1.8, 99], weight: 4, time: 'any', power: 1.3, patience: 0.9,
    },
    // まん丸でトゲトゲ。どこでもたまに釣れる
    puffer: {
        name: 'フグ', rarity: 2, sizeCm: [15, 35],
        length: 0.34, height: 0.72, width: 0.66, fat: 0.4,
        back: PALETTE.grass, belly: PALETTE.sand, fin: PALETTE.sand, pattern: 'spots', patternColor: PALETTE.bark, tail: 'fan', dorsal: 0.3, spikes: true,
        depth: [0.6, 99], weight: 2, time: 'any', power: 0.8, patience: 1.3,
    },
    // 深い所の海底。夜によく釣れる平たい魚
    flounder: {
        name: 'ヒラメ', rarity: 2, sizeCm: [30, 70],
        length: 0.46, height: 0.12, width: 0.5, fat: 0.45,
        back: PALETTE.trunk, belly: PALETTE.sand, fin: PALETTE.trunk, pattern: 'spots', patternColor: PALETTE.bark, tail: 'round', dorsal: 0, flat: true,
        depth: [3, 99], weight: 3, time: 'night', power: 1.1, patience: 1.1,
    },
    // 沖の深い所の昼だけ。大きくて強い
    bonito: {
        name: 'カツオ', rarity: 3, sizeCm: [45, 90],
        length: 0.56, height: 0.3, width: 0.22, fat: 0.38,
        back: PALETTE.bark, belly: PALETTE.sky, fin: PALETTE.water, pattern: 'stripes', patternColor: PALETTE.water, tail: 'lunate', dorsal: 0.9,
        depth: [4, 99], weight: 2, time: 'day', power: 1.8, patience: 0.75,
    },
};
export function isFish(item) {
    return FISH_IDS.includes(item);
}
/** その水深・時間に釣れる魚から、重みに従って1種類選ぶ（自分だけの行動なので Math.random() でよい） */
export function pickFish(depth, night) {
    const ok = FISH_IDS.filter((id) => {
        const k = FISH_KINDS[id];
        return depth >= k.depth[0] && depth <= k.depth[1] && (k.time === 'any' || (k.time === 'night') === night);
    });
    let r = Math.random() * ok.reduce((sum, id) => sum + FISH_KINDS[id].weight, 0);
    for (const id of ok) {
        r -= FISH_KINDS[id].weight;
        if (r <= 0)
            return id;
    }
    return 'fish';
}
