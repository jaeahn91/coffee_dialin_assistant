import type { Move, Prescription, RuleSource, Strength, Taste } from "./types";

// §6-1 추출 컨트롤 격자 (추출시간 정상 범위). 가로축 수율(신↔쓴), 세로축 농도(진↔묽). 중앙=유지.
// medium 행의 단일변수 칸(sour/bitter)을 PRD는 "분쇄 곱게 / 물온도↑" 식 OR로 제시한다.
// 거울상 대칭(§6-3)을 명확히 유지하기 위해 분쇄(grind)를 정규 처방으로 채택했다. 물온도는 대안.

const grind = (direction: "finer" | "coarser"): Move => ({ variable: "grind", direction, magnitude: "standard" });
const water = (direction: "more" | "less"): Move => ({ variable: "water", direction, magnitude: "standard" });

export const ALL_TASTES: Taste[] = ["sour", "balanced", "bitter"];
export const ALL_STRENGTHS: Strength[] = ["strong", "medium", "light"];

export function gridCell(taste: Taste, strength: Strength): Prescription {
  if (taste === "balanced" && strength === "medium") return { kind: "hold" };

  const source: RuleSource = { path: "grid", cell: `${taste}/${strength}` };
  const adjust = (moves: Move[]): Prescription => ({ kind: "adjust", moves, source });

  switch (`${taste}/${strength}`) {
    case "sour/strong":     return adjust([grind("finer"), water("more")]);   // 저추출 + 과농도
    case "balanced/strong": return adjust([water("more")]);                   // 적정 + 과농도
    case "bitter/strong":   return adjust([grind("coarser"), water("more")]); // 과추출 + 과농도
    case "sour/medium":     return adjust([grind("finer")]);                  // 저추출
    case "bitter/medium":   return adjust([grind("coarser")]);               // 과추출
    case "sour/light":      return adjust([grind("finer"), water("less")]);   // 저추출 + 저농도
    case "balanced/light":  return adjust([water("less")]);                  // 적정 + 저농도
    case "bitter/light":    return adjust([grind("coarser"), water("less")]); // 과추출 + 저농도
    default:                return { kind: "hold" };
  }
}
