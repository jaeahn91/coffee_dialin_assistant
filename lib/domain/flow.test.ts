import { describe, expect, it } from "vitest";
import { flowStep, type FlowInput } from "./flow";
import { gridCell } from "./grid";
import { temperatureTree } from "./tree";

const askId = (input: FlowInput) => {
  const r = flowStep(input);
  return r.kind === "ask" ? r.question.id : `done:${r.prescription.kind}`;
};

describe("§5 흐름 — 진입/만족도", () => {
  it("빈 입력은 만족도부터 묻는다", () => {
    expect(askId({})).toBe("satisfaction");
  });

  it("좋아요 → 유지(hold)", () => {
    const r = flowStep({ satisfaction: "good" });
    expect(r).toEqual({ kind: "done", prescription: { kind: "hold" } });
  });
});

describe("§5 흐름 — 괜찮아요 = C(경량)", () => {
  it("시간·온도를 묻지 않고 곧장 맛 → 농도", () => {
    expect(askId({ satisfaction: "okay" })).toBe("taste");
    expect(askId({ satisfaction: "okay", taste: "sour" })).toBe("strength");
  });

  it("맛+농도 결과는 격자와 동일", () => {
    const r = flowStep({ satisfaction: "okay", taste: "sour", strength: "strong" });
    expect(r).toEqual({ kind: "done", prescription: gridCell("sour", "strong") });
  });

  it("괜찮아요도 균형+적당이면 유지로 수렴", () => {
    const r = flowStep({ satisfaction: "okay", taste: "balanced", strength: "medium" });
    expect(r).toEqual({ kind: "done", prescription: { kind: "hold" } });
  });

  it("맛/농도 '해당 없음'은 챗봇 폴백", () => {
    expect(askId({ satisfaction: "okay", taste: "na" })).toBe("done:chatbot");
    expect(askId({ satisfaction: "okay", taste: "sour", strength: "na" })).toBe("done:chatbot");
  });
});

describe("§5 흐름 — 아쉬워요", () => {
  it("먼저 추출시간을 묻는다", () => {
    expect(askId({ satisfaction: "bad" })).toBe("time");
  });

  it("시간 비슷 → 격자 경로(맛부터)", () => {
    expect(askId({ satisfaction: "bad", time: "similar" })).toBe("taste");
    const r = flowStep({ satisfaction: "bad", time: "similar", taste: "bitter", strength: "light" });
    expect(r).toEqual({ kind: "done", prescription: gridCell("bitter", "light") });
  });

  it("시간 짧/길 → 온도 분기 트리(temp부터)", () => {
    expect(askId({ satisfaction: "bad", time: "short" })).toBe("temp");
    expect(askId({ satisfaction: "bad", time: "long" })).toBe("temp");
  });

  it("온도 높음+시간 짧음 → 추가질문 없이 바로 처방", () => {
    const tree = temperatureTree({ time: "short", temp: "high" });
    expect(tree.kind).toBe("prescription");
    if (tree.kind !== "prescription") return;
    const r = flowStep({ satisfaction: "bad", time: "short", temp: "high" });
    expect(r).toEqual({ kind: "done", prescription: tree.prescription });
  });

  it("온도 낮음+시간 길음 → 쓴맛 강·약 후속질문", () => {
    const r = flowStep({ satisfaction: "bad", time: "long", temp: "low" });
    expect(r.kind).toBe("ask");
    if (r.kind === "ask" && r.question.id === "intensity") {
      expect(r.question.ask).toBe("bitter");
    } else {
      throw new Error("intensity 질문이어야 함");
    }
  });

  it("온도 낮음+시간 짧음 → 신맛 강·약 후속질문", () => {
    const r = flowStep({ satisfaction: "bad", time: "short", temp: "low" });
    expect(r.kind).toBe("ask");
    if (r.kind === "ask" && r.question.id === "intensity") {
      expect(r.question.ask).toBe("sour");
    } else {
      throw new Error("intensity 질문이어야 함");
    }
  });

  it("후속질문(강/약)까지 답하면 최종 처방으로 종료", () => {
    const r = flowStep({ satisfaction: "bad", time: "long", temp: "low", intensity: "strong" });
    expect(r.kind).toBe("done");
    if (r.kind === "done") expect(r.prescription.kind).toBe("adjust");
  });
});
