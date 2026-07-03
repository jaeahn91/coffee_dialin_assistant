import { describe, expect, it } from "vitest";
import { describeMove, describePrescription, LIMIT_NOTICES } from "./describe";
import { allSystemMoves } from "./invariants";
import type { Move, Prescription } from "./types";

// §9 불변식: 처방 설명은 고정 템플릿(생성형 X). 아래 표가 템플릿의 기준이며,
// 문구를 바꾸려면 여기도 함께 바꿔야 한다 — 변경이 의도적임을 강제한다.

const MOVE_TEMPLATES: [Move, string][] = [
  [{ variable: "grind", direction: "finer", magnitude: "standard" }, "분쇄도를 곱게"],
  [{ variable: "grind", direction: "finer", magnitude: "slight" }, "분쇄도를 조금 곱게"],
  [{ variable: "grind", direction: "coarser", magnitude: "standard" }, "분쇄도를 굵게"],
  [{ variable: "grind", direction: "coarser", magnitude: "slight" }, "분쇄도를 조금 굵게"],
  [{ variable: "water", direction: "more", magnitude: "standard" }, "물을 늘리기"],
  [{ variable: "water", direction: "more", magnitude: "slight" }, "물을 조금 늘리기"],
  [{ variable: "water", direction: "less", magnitude: "standard" }, "물을 줄이기"],
  [{ variable: "water", direction: "less", magnitude: "slight" }, "물을 조금 줄이기"],
  [{ variable: "temp", direction: "up", magnitude: "standard" }, "물온도를 높이기"],
  [{ variable: "temp", direction: "up", magnitude: "slight" }, "물온도를 조금 높이기"],
  [{ variable: "temp", direction: "down", magnitude: "standard" }, "물온도를 낮추기"],
  [{ variable: "temp", direction: "down", magnitude: "slight" }, "물온도를 조금 낮추기"],
  [{ variable: "temp", direction: "reset", magnitude: "standard" }, "물온도를 레시피 기준으로"],
  [{ variable: "temp", direction: "reset", magnitude: "slight" }, "물온도를 레시피 기준으로"],
];

const key = (m: Move) => `${m.variable}/${m.direction}/${m.magnitude}`;

describe("describeMove — §9 고정 템플릿", () => {
  it("모든 (변수×방향×폭) 조합의 문구가 표와 일치한다", () => {
    for (const [move, expected] of MOVE_TEMPLATES) {
      expect(describeMove(move), key(move)).toBe(expected);
    }
  });

  it("시스템(격자∪트리)이 낼 수 있는 모든 move가 템플릿 표에 있다", () => {
    const known = new Set(MOVE_TEMPLATES.map(([m]) => key(m)));
    for (const m of allSystemMoves()) {
      expect(known.has(key(m)), `템플릿 표에 없는 move: ${key(m)}`).toBe(true);
    }
  });
});

describe("describePrescription — §9 고정 템플릿", () => {
  it("hold 문구", () => {
    expect(describePrescription({ kind: "hold" })).toBe("지금 레시피를 그대로 유지하세요.");
  });

  it("chatbot 문구 (reason과 무관하게 고정)", () => {
    expect(describePrescription({ kind: "chatbot", reason: "아무거나" })).toBe(
      "자동 조정 규칙 밖의 경우예요. 맞춤 상담 기능은 준비 중이에요 — 지금은 로스터리에 직접 문의해 주시면 가장 정확해요.",
    );
  });

  it("경계 도달 고정 문구(ADR-003)가 표와 일치한다", () => {
    expect(LIMIT_NOTICES.grind).toBe(
      "분쇄도는 이미 충분히 조정했어요. 그래도 아쉬우면 로스터리에 문의해 주세요.",
    );
    expect(LIMIT_NOTICES.water).toBe(
      "물 양은 이미 충분히 조정했어요. 그래도 아쉬우면 로스터리에 문의해 주세요.",
    );
    expect(LIMIT_NOTICES.temp).toBe(
      "물온도는 이미 충분히 조정했어요. 그래도 아쉬우면 로스터리에 문의해 주세요.",
    );
  });

  it("adjust는 move 문구를 ' + '로 잇는다", () => {
    const p: Prescription = {
      kind: "adjust",
      moves: [
        { variable: "grind", direction: "finer", magnitude: "standard" },
        { variable: "water", direction: "more", magnitude: "standard" },
      ],
      source: { path: "grid", cell: "sour/strong" },
    };
    expect(describePrescription(p)).toBe("분쇄도를 곱게 + 물을 늘리기");
  });
});
