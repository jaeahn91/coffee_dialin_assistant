import { ALL_STRENGTHS, ALL_TASTES, gridCell } from "./grid";
import { temperatureTree, type TreeResult } from "./tree";
import type { Move, Strength, Taste, TempVsRecipe } from "./types";

// §6-3 거울상 불변식 검증용 순수 헬퍼.
// 모든 *방향성* 처방(분쇄 곱게/굵게, 물 늘림/줄임, 온도 up/down)은 역방향 경로가 있어야 한다.
// *기준점 복귀형*(temp reset)은 자기 한계가 있어 예외.

export function isDirectional(m: Move): boolean {
  return !(m.variable === "temp" && m.direction === "reset");
}

export function reverseMove(m: Move): Move | null {
  switch (m.variable) {
    case "grind":
      return { ...m, direction: m.direction === "finer" ? "coarser" : "finer" };
    case "water":
      return { ...m, direction: m.direction === "more" ? "less" : "more" };
    case "temp":
      if (m.direction === "reset") return null; // 예외
      return { ...m, direction: m.direction === "up" ? "down" : "up" };
  }
}

export const oppositeTaste = (t: Taste): Taste =>
  t === "sour" ? "bitter" : t === "bitter" ? "sour" : "balanced";

export const oppositeStrength = (s: Strength): Strength =>
  s === "strong" ? "light" : s === "light" ? "strong" : "medium";

// 트리의 모든 잎이 내는 처방 묶음(후속질문이 있는 분기는 강/약 둘 다 펼친다).
export function allTreeLeaves(): { id: string; moves: Move[] }[] {
  const temps: TempVsRecipe[] = ["high", "low", "similar", "unknown"];
  const out: { id: string; moves: Move[] }[] = [];

  const collect = (r: TreeResult) => {
    if (r.kind === "prescription" && r.prescription.kind === "adjust") {
      const src = r.prescription.source;
      out.push({ id: src.path === "tree" ? src.leaf : src.cell, moves: r.prescription.moves });
    }
  };

  for (const time of ["short", "long"] as const) {
    for (const t of temps) {
      const r = temperatureTree({ time, temp: t });
      if (r.kind === "followup") {
        collect(temperatureTree({ time, temp: t, intensity: "strong" }));
        collect(temperatureTree({ time, temp: t, intensity: "weak" }));
      } else {
        collect(r);
      }
    }
  }
  return out;
}

// 시스템 전체(격자 ∪ 트리)의 모든 move.
export function allSystemMoves(): Move[] {
  const moves: Move[] = [];
  for (const t of ALL_TASTES) {
    for (const s of ALL_STRENGTHS) {
      const p = gridCell(t, s);
      if (p.kind === "adjust") moves.push(...p.moves);
    }
  }
  for (const leaf of allTreeLeaves()) moves.push(...leaf.moves);
  return moves;
}
