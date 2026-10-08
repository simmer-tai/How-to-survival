import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { VIEW_LAYER } from './hand.js';

// 手に持った松明の明かり。自分と、同じ場所にいるほかの人の松明の炎の位置に明かりを置く（自分の画面だけの演出）。
// 明かりの数が変わるとシェーダーを作り直して一瞬止まるので、決まった数の明かりをいつも置いておき、使わない明かりは強さを 0 にする

const LIGHTS = 3; // 明かりの数（自分のぶんと、近くの人のぶん。これより多い松明は照らさない）
const INTENSITY = 7; // 明かりの強さ（1m の所での明るさ。昼の太陽は 2.8）
const RANGE = 30; // 明かりが届く距離（ここで明るさが 0 になる）
const DECAY = 0.8; // 離れると暗くなる度合い（明るさは 距離^DECAY に反比例。小さいほど遠くまで明るい。3m で太陽くらい、10m でその3分の1くらい）
const FLICKER = 0.1; // 炎のゆらぎで明かりの強さが変わる割合

/** 明かりの色（赤と砂色のあいだの、暖かい色） */
const LIGHT_COLOR = new THREE.Color(PALETTE.accent).lerp(new THREE.Color(PALETTE.sand), 0.55);

export class TorchLights {
  private readonly lights: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < LIGHTS; i++) {
      const light = new THREE.PointLight(LIGHT_COLOR, 0, RANGE, DECAY);
      light.layers.enable(VIEW_LAYER); // 手や持ち物も照らす（洞窟の中では日の光が届かないので）
      scene.add(light);
      this.lights.push(light);
    }
  }

  /** flames は炎の位置（先にあるものほど優先して照らす。自分の松明を先頭に）。seconds はゆらぎに使う時間（秒） */
  update(flames: THREE.Vector3[], seconds: number): void {
    this.lights.forEach((light, i) => {
      const at = flames[i];
      if (!at) {
        light.intensity = 0;
        return;
      }
      light.position.copy(at);
      const flicker = 1 + FLICKER * (Math.sin(seconds * 10 + i * 1.7) * 0.6 + Math.sin(seconds * 25.3 + i * 2.9) * 0.4);
      light.intensity = INTENSITY * flicker;
    });
  }
}
