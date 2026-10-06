import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { flat } from '../core/materials.js';
import { terrainHeight } from '../world/terrain.js';
import { WATER_LEVEL } from '../core/physics.js';
import { waveOffset } from '../core/waves.js';
import type { Inventory, ItemId } from '../items/inventory.js';
import type { Vitals } from '../player/vitals.js';

/** 食べられるアイテムと、1個で回復する量 */
export const FOODS: Partial<Record<ItemId, { hunger: number; thirst: number }>> = {
  berry: { hunger: 8, thirst: 2 },
  fish: { hunger: 20, thirst: 0 },
  clownfish: { hunger: 10, thirst: 0 },
  snapper: { hunger: 30, thirst: 0 },
  puffer: { hunger: 15, thirst: 0 },
  flounder: { hunger: 30, thirst: 0 },
  bonito: { hunger: 45, thirst: 2 },
};

export const EAT_TIME = 0.6; // 口へ運んで食べ終わるまで（秒）
const DRINK_AMOUNT = 12; // 1口で回復する水分
const DRINK_COOLDOWN = 0.4; // F を押しっぱなしにしても、この間隔でしか飲めない
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const DRINK_REACH = 3.2; // 視線の先、この距離までの水面から飲める
const SPLASH_COUNT = 8;
const splashGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);

/** 右クリックで手に持った食べ物を食べる。口へ運び終わったときに1個減って回復する */
export class Eater {
  private item: ItemId | null = null;
  private time = 0;

  constructor(
    private readonly inventory: Inventory,
    private readonly vitals: Vitals,
  ) {}

  /** 食べ始められたら true（食べ物でない・おなかがいっぱい・食べている途中なら false） */
  start(item: ItemId): boolean {
    if (this.item || !FOODS[item] || !this.vitals.canEat) return false;
    this.item = item;
    this.time = EAT_TIME;
    return true;
  }

  update(dt: number): void {
    if (!this.item) return;
    this.time -= dt;
    if (this.time > 0) return;
    const food = FOODS[this.item]!;
    if (this.inventory.remove(this.item)) {
      this.vitals.eat(food.hunger);
      this.vitals.drink(food.thirst);
    }
    this.item = null;
  }
}

interface Drop { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }

/** 水面に視線を合わせて F で水を飲む */
export class Drinker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly drops: Drop[] = [];
  private cooldown = 0;

  constructor(
    private readonly world: THREE.Object3D,
    /** 水面との間をさえぎる物（岩・桟橋・建てた部材など） */
    private readonly blockers: THREE.Object3D[],
    private readonly vitals: Vitals,
  ) {}

  /** 手の届く水面を見ていれば、その点を返す */
  aimed(camera: THREE.Camera): THREE.Vector3 | null {
    this.raycaster.setFromCamera(SCREEN_CENTER, camera);
    const { origin, direction } = this.raycaster.ray;
    if (direction.y >= -0.05) return null;
    const surface = WATER_LEVEL + waveOffset(origin.x, origin.z);
    const dist = (surface - origin.y) / direction.y;
    if (dist < 0 || dist > DRINK_REACH) return null;
    const point = origin.clone().addScaledVector(direction, dist);
    if (terrainHeight(point.x, point.z) > surface - 0.05) return null; // 陸地や水が浅すぎる所
    this.raycaster.far = dist;
    if (this.raycaster.intersectObjects(this.blockers, false).length > 0) return null;
    return point;
  }

  /** 狙っている水面から1口飲む。飲めたら true */
  drink(camera: THREE.Camera): boolean {
    if (this.cooldown > 0 || !this.vitals.canDrink) return false;
    const point = this.aimed(camera);
    if (!point) return false;
    this.vitals.drink(DRINK_AMOUNT);
    this.cooldown = DRINK_COOLDOWN;
    this.splash(point);
    return true;
  }

  update(dt: number): void {
    this.cooldown = Math.max(this.cooldown - dt, 0);
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.removeFromParent();
        this.drops.splice(i, 1);
        continue;
      }
      d.velocity.y -= 14 * dt;
      d.mesh.position.addScaledVector(d.velocity, dt);
    }
  }

  /** すくった所から水しぶきを上げる */
  private splash(point: THREE.Vector3): void {
    for (let n = 0; n < SPLASH_COUNT; n++) {
      const mesh = new THREE.Mesh(splashGeo, flat(PALETTE.water));
      mesh.position.copy(point);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      const a = Math.random() * Math.PI * 2;
      const velocity = new THREE.Vector3(Math.cos(a) * 1.2, 2.5 + Math.random() * 1.5, Math.sin(a) * 1.2);
      this.world.add(mesh);
      this.drops.push({ mesh, velocity, life: 0.5 + Math.random() * 0.2 });
    }
  }
}
