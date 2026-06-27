import { describe, expect, it } from "vitest";
import { ALL_STRENGTHS, ALL_TASTES, gridCell } from "./grid";
import {
  allSystemMoves,
  isDirectional,
  oppositeStrength,
  oppositeTaste,
  reverseMove,
} from "./invariants";
import { temperatureTree } from "./tree";
import type { Move } from "./types";

const key = (m: Move) => `${m.variable}:${m.direction}`; // 방향 대칭만 본다(폭 무시)
const setOf = (ms: Move[]) => ms.map(key).sort().join(",");

describe("격자 거울상 불변식 (§6-3)", () => {
  it("중앙(balanced/medium)은 유지", () => {
    expect(gridCell("balanced", "medium")).toEqual({ kind: "hold" });
  });

  it("모든 비중앙 칸은 점대칭 반대 칸에서 역방향 처방을 가진다", () => {
    for (const t of ALL_TASTES) {
      for (const s of ALL_STRENGTHS) {
        const p = gridCell(t, s);
        if (p.kind !== "adjust") continue;
        const o = gridCell(oppositeTaste(t), oppositeStrength(s));
        expect(o.kind, `${t}/${s}의 반대 칸`).toBe("adjust");
        if (o.kind !== "adjust") continue;
        const reversed = p.moves.map(reverseMove).filter((m): m is Move => m !== null);
        expect(setOf(o.moves), `${t}/${s} 거울상`).toBe(setOf(reversed));
      }
    }
  });
});

describe("시스템 전체 거울상 (격자 ∪ 트리, §6-3)", () => {
  it("모든 방향성 처방은 시스템 어딘가에 역방향 경로가 존재한다", () => {
    const moves = allSystemMoves().filter(isDirectional);
    const present = new Set(moves.map(key));
    for (const m of moves) {
      const r = reverseMove(m);
      expect(r).not.toBeNull();
      expect(present.has(key(r as Move)), `${key(m)}의 역방향`).toBe(true);
    }
  });
});

describe("온도 분기 트리 (§6-2)", () => {
  it("low+short는 신맛, low+long은 쓴맛 후속질문을 요구", () => {
    expect(temperatureTree({ time: "short", temp: "low" })).toEqual({ kind: "followup", ask: "sour" });
    expect(temperatureTree({ time: "long", temp: "low" })).toEqual({ kind: "followup", ask: "bitter" });
  });

  it("부록11: low+long의 쓴맛 강/약 처방이 동일(변별력 상실 — 알려진 미해결 잔여)", () => {
    const strong = temperatureTree({ time: "long", temp: "low", intensity: "strong" });
    const weak = temperatureTree({ time: "long", temp: "low", intensity: "weak" });
    expect(strong.kind).toBe("prescription");
    expect(weak.kind).toBe("prescription");
    if (strong.kind === "prescription" && weak.kind === "prescription") {
      const a = strong.prescription;
      const b = weak.prescription;
      if (a.kind === "adjust" && b.kind === "adjust") {
        expect(setOf(a.moves)).toBe(setOf(b.moves));
      }
    }
  });
});
