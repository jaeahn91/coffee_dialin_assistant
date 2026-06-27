import { gridCell } from "./grid";
import { temperatureTree } from "./tree";
import type {
  Prescription,
  Satisfaction,
  Strength,
  Taste,
  TasteIntensity,
  TempVsRecipe,
  TimeDeviation,
} from "./types";

// §5 사용자 흐름 상태머신. 순수 함수: 지금까지의 답(FlowInput)을 받아
// 다음 질문(ask) 또는 최종 처방(done)을 돌려준다. UI가 상태를 들고 재호출.
// 라우팅:
//   좋아요   → 유지(hold)
//   괜찮아요 → C(경량): 시간필터·온도트리 건너뛰고 맛+농도 → 격자(§6-1)
//   아쉬워요 → 시간필터 → 짧/길이면 온도트리(§6-2) / 비슷이면 맛+농도 → 격자
//   맛/농도에서 "해당 없음" → 챗봇 폴백(§9 경계)

export type NA = "na";

export type FlowInput = {
  satisfaction?: Satisfaction;
  time?: TimeDeviation;
  temp?: TempVsRecipe;
  taste?: Taste | NA;
  strength?: Strength | NA;
  intensity?: TasteIntensity;
};

export type FlowQuestion =
  | { id: "satisfaction"; options: Satisfaction[] }
  | { id: "time"; options: TimeDeviation[] }
  | { id: "temp"; options: TempVsRecipe[] }
  | { id: "taste"; options: (Taste | NA)[] }
  | { id: "strength"; options: (Strength | NA)[] }
  | { id: "intensity"; ask: "sour" | "bitter"; options: TasteIntensity[] };

export type FlowResult =
  | { kind: "ask"; question: FlowQuestion }
  | { kind: "done"; prescription: Prescription };

const CHATBOT: Prescription = { kind: "chatbot", reason: "격자로 잡히지 않는 입력(해당 없음)" };

// 맛+농도 → 격자 경로. 괜찮아요와 아쉬워요(시간 비슷)가 공유.
function gridPath(input: FlowInput): FlowResult {
  if (input.taste === undefined)
    return { kind: "ask", question: { id: "taste", options: ["sour", "balanced", "bitter", "na"] } };
  if (input.taste === "na") return { kind: "done", prescription: CHATBOT };
  if (input.strength === undefined)
    return { kind: "ask", question: { id: "strength", options: ["strong", "medium", "light", "na"] } };
  if (input.strength === "na") return { kind: "done", prescription: CHATBOT };
  return { kind: "done", prescription: gridCell(input.taste, input.strength) };
}

export function flowStep(input: FlowInput): FlowResult {
  if (input.satisfaction === undefined)
    return { kind: "ask", question: { id: "satisfaction", options: ["bad", "okay", "good"] } };

  if (input.satisfaction === "good") return { kind: "done", prescription: { kind: "hold" } };

  if (input.satisfaction === "okay") return gridPath(input); // C 경로

  // 아쉬워요(bad)
  if (input.time === undefined)
    return { kind: "ask", question: { id: "time", options: ["short", "similar", "long"] } };
  if (input.time === "similar") return gridPath(input);

  const time = input.time; // "short" | "long" → 온도 분기 트리(§6-2)
  if (input.temp === undefined)
    return {
      kind: "ask",
      question: { id: "temp", options: ["high", "low", "similar", "unknown"] },
    };
  const temp = input.temp;

  const probe = temperatureTree({ time, temp });
  if (probe.kind === "prescription") return { kind: "done", prescription: probe.prescription };

  // followup: 신맛/쓴맛 강·약
  if (input.intensity === undefined)
    return { kind: "ask", question: { id: "intensity", ask: probe.ask, options: ["strong", "weak"] } };

  const final = temperatureTree({ time, temp, intensity: input.intensity });
  if (final.kind === "prescription") return { kind: "done", prescription: final.prescription };
  return { kind: "done", prescription: CHATBOT }; // 도달 불가 — 방어
}
