import type { Magnitude, Move, Prescription } from "./types";

// §9: "예상 결과 한 줄"은 규칙 기반 고정 템플릿(생성형 X). 처방을 사람이 읽을 한국어로 옮긴다.

const MAG: Record<Magnitude, string> = { slight: "조금 ", standard: "" };

export function describeMove(m: Move): string {
  const mag = MAG[m.magnitude];
  switch (m.variable) {
    case "grind":
      return `분쇄도를 ${mag}${m.direction === "finer" ? "곱게" : "굵게"}`;
    case "water":
      return `물을 ${mag}${m.direction === "more" ? "늘리기" : "줄이기"}`;
    case "temp":
      if (m.direction === "reset") return "물온도를 레시피 기준으로";
      return `물온도를 ${mag}${m.direction === "up" ? "높이기" : "낮추기"}`;
  }
}

export function describePrescription(p: Prescription): string {
  switch (p.kind) {
    case "hold":
      return "지금 레시피를 그대로 유지하세요.";
    case "chatbot":
      return "격자로 잡히지 않는 경우라, 맞춤 조정을 위해 몇 가지를 더 여쭤볼게요.";
    case "adjust":
      return p.moves.map(describeMove).join(" + ");
  }
}
