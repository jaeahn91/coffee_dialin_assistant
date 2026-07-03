import { describe, expect, it } from "vitest";
import { applyMoves, deriveFeedback, trailingGrindRun, type RecipeParams } from "./derive";
import type { Move } from "../domain/types";

// ADR-001: 서버 재도출이 (1) 경로를 올바르게 분류하고 (2) 실제 질문된 답만 채택하며
// (3) 완주하지 못한/깨진 페이로드를 거부하는지 검증한다.

describe("deriveFeedback — 경로 분류", () => {
  it("좋아요 → immediate + hold, 다른 답은 기록하지 않는다", () => {
    const r = deriveFeedback({ satisfaction: "good" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.derivation.path).toBe("immediate");
    expect(r.derivation.prescription).toEqual({ kind: "hold" });
    expect(r.derivation.record.time_answer).toBeNull();
    expect(r.derivation.record.grid_cell).toBeNull();
  });

  it("괜찮아요(C 경로) → grid + 격자 칸", () => {
    const r = deriveFeedback({ satisfaction: "okay", taste: "sour", strength: "strong" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.derivation.path).toBe("grid");
    expect(r.derivation.record.grid_cell).toBe("sour/strong");
    expect(r.derivation.prescription.kind).toBe("adjust");
  });

  it("아쉬워요+시간 비슷 → grid, time_answer 기록", () => {
    const r = deriveFeedback({
      satisfaction: "bad", time: "similar", taste: "balanced", strength: "medium",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.derivation.path).toBe("grid");
    expect(r.derivation.record.time_answer).toBe("similar");
    expect(r.derivation.prescription).toEqual({ kind: "hold" }); // 격자 중앙
  });

  it("아쉬워요+시간 짧음 → tree + 잎 ID", () => {
    const r = deriveFeedback({
      satisfaction: "bad", time: "short", temp: "low", intensity: "weak",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.derivation.path).toBe("tree");
    expect(r.derivation.record.tree_leaf).toBe("low/short/sour-weak");
    expect(r.derivation.record.temp_answer).toBe("low");
    expect(r.derivation.record.intensity_answer).toBe("weak");
  });

  it("맛 '해당 없음' → chatbot, taste_answer는 null", () => {
    const r = deriveFeedback({ satisfaction: "okay", taste: "na" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.derivation.path).toBe("chatbot");
    expect(r.derivation.record.taste_answer).toBeNull();
    expect(r.derivation.record.grid_cell).toBeNull();
  });
});

describe("deriveFeedback — 경로 밖 필드 무시(화이트리스트)", () => {
  it("good인데 딸려온 taste/temp는 채택하지 않는다", () => {
    const r = deriveFeedback({ satisfaction: "good", taste: "sour", temp: "high" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.derivation.record.taste_answer).toBeNull();
    expect(r.derivation.record.temp_answer).toBeNull();
  });
});

describe("deriveFeedback — 거부", () => {
  it("미완주(질문 남음) → incomplete", () => {
    expect(deriveFeedback({ satisfaction: "okay" })).toEqual({
      ok: false, error: "incomplete",
    });
    expect(deriveFeedback({})).toEqual({ ok: false, error: "incomplete" });
  });

  it("enum 밖 값 → invalid", () => {
    expect(deriveFeedback({ satisfaction: "great" })).toEqual({
      ok: false, error: "invalid",
    });
    expect(deriveFeedback("문자열")).toEqual({ ok: false, error: "invalid" });
  });
});

const grindMove = (direction: "finer" | "coarser"): Move => ({
  variable: "grind", direction, magnitude: "slight",
});

describe("applyMoves — after_snapshot 수치 적용", () => {
  const before: RecipeParams = {
    dose_g: 15, water_g: 250, water_temp_c: 92, grind_text: "코만단테 22클릭",
  };
  const base = { tempC: 92, waterG: 250 };

  it("물 standard = 원두량×0.5(+7.5g = 비율 0.5), 온도 slight(-1°C)", () => {
    const r = applyMoves(
      before,
      [
        { variable: "water", direction: "more", magnitude: "standard" },
        { variable: "temp", direction: "down", magnitude: "slight" },
      ],
      base,
      [],
    );
    expect(r.after.water_g).toBe(257.5);
    expect(r.after.water_temp_c).toBe(91);
    expect(r.moves).toHaveLength(2);
    expect(r.limited).toEqual([]);
  });

  it("도징 미상이면 물 스텝은 고정 폴백(standard 10g)", () => {
    const r = applyMoves(
      { ...before, dose_g: null },
      [{ variable: "water", direction: "more", magnitude: "standard" }],
      base,
      [],
    );
    expect(r.after.water_g).toBe(260);
  });

  it("분쇄 move는 수치 미적용(§6-4 미결정) — 파라미터 불변, move는 채택", () => {
    const r = applyMoves(
      before,
      [{ variable: "grind", direction: "finer", magnitude: "standard" }],
      base,
      [],
    );
    expect(r.after).toEqual(before);
    expect(r.moves).toHaveLength(1);
  });

  it("temp reset은 기준 온도로 복귀", () => {
    const heated = { ...before, water_temp_c: 96 };
    const r = applyMoves(
      heated,
      [{ variable: "temp", direction: "reset", magnitude: "slight" }],
      base,
      [],
    );
    expect(r.after.water_temp_c).toBe(92);
  });

  it("null 파라미터는 건드리지 않는다", () => {
    const sparse: RecipeParams = {
      dose_g: null, water_g: null, water_temp_c: null, grind_text: null,
    };
    const r = applyMoves(
      sparse,
      [{ variable: "water", direction: "less", magnitude: "slight" }],
      { tempC: null, waterG: null },
      [],
    );
    expect(r.after.water_g).toBeNull();
    expect(r.moves).toHaveLength(1); // 수치 미상 — 기호만 기록(기존 동작)
  });
});

describe("applyMoves — 절대 경계(ADR-003)", () => {
  const before: RecipeParams = {
    dose_g: 15, water_g: 250, water_temp_c: 92, grind_text: null,
  };
  const base = { tempC: 92, waterG: 250 };

  it("온도 하한 80°C: 이미 하한이면 down 무효화 + limited", () => {
    const r = applyMoves(
      { ...before, water_temp_c: 80 },
      [{ variable: "temp", direction: "down", magnitude: "slight" }],
      base,
      [],
    );
    expect(r.after.water_temp_c).toBe(80);
    expect(r.moves).toEqual([]);
    expect(r.limited).toEqual(["temp"]);
  });

  it("온도 상한 100°C: 99에서 standard(+2)는 100으로 부분 클램프 — move는 채택", () => {
    const r = applyMoves(
      { ...before, water_temp_c: 99 },
      [{ variable: "temp", direction: "up", magnitude: "standard" }],
      base,
      [],
    );
    expect(r.after.water_temp_c).toBe(100);
    expect(r.moves).toHaveLength(1);
    expect(r.limited).toEqual([]);
  });

  it("물량 상한(기준 ±20%): 300(=250×1.2)에서 more 무효화", () => {
    const r = applyMoves(
      { ...before, water_g: 300 },
      [{ variable: "water", direction: "more", magnitude: "standard" }],
      base,
      [],
    );
    expect(r.after.water_g).toBe(300);
    expect(r.moves).toEqual([]);
    expect(r.limited).toEqual(["water"]);
  });

  it("물량 부분 클램프: 297.5 + 7.5 → 상한 300에서 멈춤 — move는 채택", () => {
    const r = applyMoves(
      { ...before, water_g: 297.5 },
      [{ variable: "water", direction: "more", magnitude: "standard" }],
      base,
      [],
    );
    expect(r.after.water_g).toBe(300);
    expect(r.moves).toHaveLength(1);
  });

  it("물량 하한: 200(=250×0.8)에서 less 무효화", () => {
    const r = applyMoves(
      { ...before, water_g: 200 },
      [{ variable: "water", direction: "less", magnitude: "standard" }],
      base,
      [],
    );
    expect(r.after.water_g).toBe(200);
    expect(r.limited).toEqual(["water"]);
  });

  it("경계의 역방향은 항상 허용(§6-3 거울상 유지): 80°C에서 up", () => {
    const r = applyMoves(
      { ...before, water_temp_c: 80 },
      [{ variable: "temp", direction: "up", magnitude: "slight" }],
      base,
      [],
    );
    expect(r.after.water_temp_c).toBe(81);
    expect(r.limited).toEqual([]);
  });
});

describe("분쇄 반복 가드(ADR-003) — 같은 방향 권유 3회 연속 후 무효화", () => {
  const before: RecipeParams = {
    dose_g: 15, water_g: 250, water_temp_c: 92, grind_text: null,
  };
  const base = { tempC: 92, waterG: 250 };
  const tempDown: Move = { variable: "temp", direction: "down", magnitude: "slight" };

  it("trailingGrindRun: 최신순 이력에서 같은 방향 런을 센다", () => {
    expect(trailingGrindRun([])).toBeNull();
    expect(trailingGrindRun([[tempDown]])).toBeNull();
    expect(
      trailingGrindRun([[grindMove("finer")], [grindMove("finer")], [grindMove("coarser")]]),
    ).toEqual({ direction: "finer", length: 2 });
  });

  it("3회 연속이면 4번째 같은 방향은 무효화 + limited", () => {
    const hist = [[grindMove("finer")], [grindMove("finer")], [grindMove("finer")]];
    const r = applyMoves(before, [grindMove("finer")], base, hist);
    expect(r.moves).toEqual([]);
    expect(r.limited).toEqual(["grind"]);
  });

  it("2회 연속까지는 허용", () => {
    const hist = [[grindMove("finer")], [grindMove("finer")]];
    const r = applyMoves(before, [grindMove("finer")], base, hist);
    expect(r.moves).toHaveLength(1);
    expect(r.limited).toEqual([]);
  });

  it("다른 변수 조정이 껴도 런은 끊기지 않는다(그라인더 위치는 그대로)", () => {
    const hist = [[tempDown], [grindMove("finer")], [tempDown], [grindMove("finer")], [grindMove("finer")]];
    const r = applyMoves(before, [grindMove("finer")], base, hist);
    expect(r.moves).toEqual([]);
    expect(r.limited).toEqual(["grind"]);
  });

  it("반대 방향 권유는 런을 리셋하고 항상 허용(§6-3 거울상 유지)", () => {
    const hist = [[grindMove("finer")], [grindMove("finer")], [grindMove("finer")]];
    const r = applyMoves(before, [grindMove("coarser")], base, hist);
    expect(r.moves).toHaveLength(1);
    expect(r.limited).toEqual([]);
  });

  it("무효화돼 moves가 빈 조정은 런에 영향 없음 — 계속 막힌다", () => {
    const hist = [[], [grindMove("finer")], [grindMove("finer")], [grindMove("finer")]];
    const r = applyMoves(before, [grindMove("finer")], base, hist);
    expect(r.moves).toEqual([]);
    expect(r.limited).toEqual(["grind"]);
  });
});
