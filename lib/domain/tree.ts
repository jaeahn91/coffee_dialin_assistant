import type { Move, Prescription, TasteIntensity, TempVsRecipe } from "./types";

// §6-2 추출시간 이탈(짧/길) 시 물온도 분기 트리. 최대 2질문(온도 + 맛 1개). 격자(§6-1)로 진입하지 않는다.

const grind = (direction: "finer" | "coarser"): Move => ({ variable: "grind", direction, magnitude: "slight" });
const temp = (direction: "up" | "down" | "reset"): Move => ({ variable: "temp", direction, magnitude: "slight" });

export type TreeResult =
  | { kind: "prescription"; prescription: Prescription }
  | { kind: "followup"; ask: "sour" | "bitter" }; // 한 단계 더 묻는다(low 분기)

export function temperatureTree(input: {
  time: "short" | "long";
  temp: TempVsRecipe;
  intensity?: TasteIntensity; // 후속질문 답: low+short→신맛, low+long→쓴맛
}): TreeResult {
  const { time, temp: t, intensity } = input;
  const leaf = (id: string, moves: Move[]): TreeResult => ({
    kind: "prescription",
    prescription: { kind: "adjust", moves, source: { path: "tree", leaf: id } },
  });

  if (t === "high") {
    return time === "short"
      ? leaf("high/short", [temp("down")]) // 물온도 낮춰서 다시
      : leaf("high/long", [grind("coarser")]); // 분쇄 약간 굵게
  }

  if (t === "low") {
    if (time === "short") {
      if (!intensity) return { kind: "followup", ask: "sour" };
      return intensity === "strong"
        ? leaf("low/short/sour-strong", [grind("finer")])
        : leaf("low/short/sour-weak", [grind("finer"), temp("up")]);
    }
    // time === "long"
    if (!intensity) return { kind: "followup", ask: "bitter" };
    // 부록11: 강/약 처방이 동일해져 쓴맛 질문의 변별력이 사라진다(알려진 미해결 잔여).
    // 과추출 주범인 긴 추출시간을 분쇄도로 잡는다(v0.2 결정).
    return leaf(`low/long/bitter-${intensity}`, [grind("coarser")]);
  }

  // t === "similar" | "unknown"
  return time === "short"
    ? leaf(`${t}/short`, [grind("finer")])
    : leaf(`${t}/long`, [grind("coarser")]);
}
