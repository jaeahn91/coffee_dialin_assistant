import { describe, expect, it } from "vitest";
import { applyMoves, deriveFeedback, type RecipeParams } from "./derive";

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

describe("applyMoves — after_snapshot 수치 적용", () => {
  const before: RecipeParams = {
    dose_g: 15, water_g: 250, water_temp_c: 92, grind_text: "코만단테 22클릭",
  };

  it("물 standard(+10g), 온도 slight(-1°C)", () => {
    const after = applyMoves(
      before,
      [
        { variable: "water", direction: "more", magnitude: "standard" },
        { variable: "temp", direction: "down", magnitude: "slight" },
      ],
      92,
    );
    expect(after.water_g).toBe(260);
    expect(after.water_temp_c).toBe(91);
  });

  it("분쇄 move는 수치 미적용(§6-4 미결정) — 파라미터 불변", () => {
    const after = applyMoves(
      before,
      [{ variable: "grind", direction: "finer", magnitude: "standard" }],
      92,
    );
    expect(after).toEqual(before);
  });

  it("temp reset은 기준 온도로 복귀", () => {
    const heated = { ...before, water_temp_c: 96 };
    const after = applyMoves(
      heated,
      [{ variable: "temp", direction: "reset", magnitude: "slight" }],
      92,
    );
    expect(after.water_temp_c).toBe(92);
  });

  it("null 파라미터는 건드리지 않는다", () => {
    const sparse: RecipeParams = {
      dose_g: null, water_g: null, water_temp_c: null, grind_text: null,
    };
    const after = applyMoves(
      sparse,
      [{ variable: "water", direction: "less", magnitude: "slight" }],
      null,
    );
    expect(after.water_g).toBeNull();
  });
});
