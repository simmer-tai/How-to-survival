import { RECIPES } from './recipes.js';

/**
 * 覚えたレシピ。設計図を持って右クリックすると、その作り方を覚える（設計図は減らない）。
 * どのレシピを覚えたかはプレイヤーごとの「自分だけ」の状態。同期はせず、各自のセーブに入る
 */

/** セーブデータ上の覚えたレシピ（作れる物の id の並び） */
export type RecipeBookSave = string[];

export class RecipeBook {
  private readonly known = new Set<string>();

  /** その物の作り方を覚えているか */
  knows(result: string): boolean {
    return this.known.has(result);
  }

  /** 作り方を覚える。新しく覚えたら true（もう覚えていたら false） */
  learn(result: string): boolean {
    if (this.known.has(result)) return false;
    this.known.add(result);
    return true;
  }

  serialize(): RecipeBookSave {
    return [...this.known];
  }

  restore(save: RecipeBookSave | undefined): void {
    this.known.clear();
    // 今あるレシピの物だけを読む（レシピがなくなった物は忘れる）
    for (const id of save ?? []) if (RECIPES.some((r) => r.result === id)) this.known.add(id);
  }
}
