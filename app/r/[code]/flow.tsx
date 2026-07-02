"use client";

import { useEffect, useRef, useState } from "react";
import { describePrescription } from "@/lib/domain/describe";
import { flowStep, type FlowInput, type FlowQuestion, type FlowResult } from "@/lib/domain/flow";
import type { Prescription } from "@/lib/domain/types";
import { UNSPECIALTY_COMPASS_URL } from "@/lib/config/links";
import { startSessionAction, submitFeedbackAction, type SubmitResult } from "./actions";
import type { StartSessionResult } from "@/lib/db/sessions";

// §5 흐름 UI (클라이언트). 질문 진행은 lib/domain/flow의 순수 상태머신을 재호출할 뿐이고,
// 기록은 서버 액션이 담당한다(ADR-001: 세션은 첫 답변 시 생성, 기록은 완주 시 1회).

export type RecipeDisplay = {
  beanName: string;
  beanIntro: string | null;
  dripper: string | null;
  dose_g: number | null;
  water_g: number | null;
  water_temp_c: number | null;
  brew_time_min_s: number | null;
  brew_time_max_s: number | null;
  grind_text: string | null;
  grind_um: number | null;
  pour_text: string | null;
};

// ADR-002: 재스캔 시 표시할 조정값(사슬 최신 after_snapshot). 분쇄도는 여기 없다 —
// 수정값 대신 권유 이력(grindAdvice)으로 보여준다.
export type AdjustedParams = {
  dose_g: number | null;
  water_g: number | null;
  water_temp_c: number | null;
};

const PROMPT: Record<Exclude<FlowQuestion["id"], "intensity">, string> = {
  satisfaction: "맛은 어땠나요?",
  time: "추천 레시피보다 추출 시간이 어땠나요?",
  temp: "레시피 기준 물 온도보다 어땠나요?",
  taste: "맛은 어느 쪽이었나요?",
  strength: "농도는 어땠나요?",
};

const LABEL: Record<string, Record<string, string>> = {
  satisfaction: { bad: "아쉬워요", okay: "괜찮아요", good: "좋아요" },
  time: { short: "짧았다", similar: "비슷했다", long: "길었다" },
  temp: { high: "높았다", low: "낮았다", similar: "비슷했다", unknown: "잘 모르겠다" },
  taste: { sour: "신 쪽", balanced: "균형", bitter: "쓴 쪽", na: "해당 없음" },
  strength: { strong: "진함", medium: "적당", light: "묽음", na: "해당 없음" },
  intensity: { strong: "강했다", weak: "약했다" },
};

const CHATBOT_EXIT: Prescription = { kind: "chatbot", reason: "사용자 도움 요청" };

function questionPrompt(q: FlowQuestion): string {
  if (q.id === "intensity") return q.ask === "sour" ? "신 맛이 났나요?" : "쓴 맛이 났나요?";
  return PROMPT[q.id];
}

function resultHeading(p: Prescription): string {
  switch (p.kind) {
    case "hold":
      return "좋아요 — 그대로!";
    case "adjust":
      return "다음엔 이렇게 조정해 보세요";
    case "chatbot":
      return "자동 조정이 어려운 경우예요";
  }
}

function formatSeconds(s: number): string {
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (min === 0) return `${sec}초`;
  return sec === 0 ? `${min}분` : `${min}분 ${sec}초`;
}

// 조정값이 있고 기준과 다르면 "260g (기준 250g)" 형태로 병기(ADR-002).
function numLine(
  label: string,
  unit: string,
  base: number | null,
  adjusted: number | null | undefined,
): string | null {
  const value = adjusted ?? base;
  if (value === null) return null;
  if (adjusted != null && base !== null && adjusted !== base)
    return `${label} ${adjusted}${unit} (기준 ${base}${unit})`;
  return `${label} ${value}${unit}`;
}

function recipeLines(r: RecipeDisplay, adj: AdjustedParams | null): string[] {
  const lines: (string | null)[] = [];
  if (r.dripper) lines.push(r.dripper);
  lines.push(numLine("원두", "g", r.dose_g, adj?.dose_g));
  lines.push(numLine("물", "g", r.water_g, adj?.water_g));
  lines.push(numLine("물온도", "°C", r.water_temp_c, adj?.water_temp_c));
  if (r.brew_time_min_s !== null && r.brew_time_max_s !== null)
    lines.push(`추출 ${formatSeconds(r.brew_time_min_s)}~${formatSeconds(r.brew_time_max_s)}`);
  else if (r.brew_time_min_s !== null || r.brew_time_max_s !== null)
    lines.push(`추출 ${formatSeconds((r.brew_time_min_s ?? r.brew_time_max_s)!)}`);
  if (r.grind_text)
    lines.push(`분쇄 ${r.grind_text}${r.grind_um !== null ? ` (약 ${r.grind_um}µm)` : ""}`);
  else if (r.grind_um !== null) lines.push(`분쇄 약 ${r.grind_um}µm`);
  return lines.filter((l): l is string => l !== null);
}

export default function Flow({
  code,
  recipe,
  adjusted,
  lastSolution,
}: {
  code: string;
  recipe: RecipeDisplay;
  adjusted: AdjustedParams | null;
  lastSolution: string | null;
}) {
  const [input, setInput] = useState<FlowInput>({});
  const [history, setHistory] = useState<FlowInput[]>([]); // 한 단계씩 되돌리기용
  const [bailed, setBailed] = useState(false);

  // 세션은 첫 답변 시 1회 시작(ADR-001). 기록도 방문당 1회 — "처음부터"는 UI만 리셋.
  const sessionRef = useRef<Promise<StartSessionResult> | null>(null);
  const submittedRef = useRef(false);

  const result: FlowResult = bailed
    ? { kind: "done", prescription: CHATBOT_EXIT }
    : flowStep(input);

  useEffect(() => {
    if (result.kind !== "done" || bailed || submittedRef.current) return;
    submittedRef.current = true;
    void (async () => {
      const session = await sessionRef.current;
      if (!session?.ok) return; // 세션이 없으면 기록만 생략 — 처방 안내는 그대로
      const r: SubmitResult = await submitFeedbackAction(code, session.sessionId, input);
      if (!r.ok) console.error("피드백 기록 실패:", r.reason);
    })();
  }, [result.kind, bailed, code, input]);

  const reset = () => {
    setInput({});
    setHistory([]);
    setBailed(false);
  };

  // 옵션 값은 flowStep이 내어준 것이라 항상 유효 — 표현 글루라서 캐스팅 허용.
  const answer = (q: FlowQuestion, value: string) => {
    if (!sessionRef.current) sessionRef.current = startSessionAction(code);
    setHistory((h) => [...h, input]);
    setInput((prev) => ({ ...prev, [q.id]: value }) as FlowInput);
  };

  const back = () => {
    if (bailed) {
      setBailed(false); // 도움 받기 화면에서 돌아오면 직전 질문 그대로
      return;
    }
    if (history.length === 0) return;
    setInput(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  };

  // 완료(기록됨) 화면에선 뒤로를 숨긴다 — 기록은 방문당 1회라 뒤로 가서 답을 바꿔도
  // 재기록되지 않아 화면과 데이터가 어긋난다. "처음부터"만 남김(도움 화면의 뒤로는 유지).
  const canGoBack = bailed || (result.kind === "ask" && history.length > 0);
  const lines = recipeLines(recipe, adjusted);
  // 붓기 텍스트는 박제(총량 조정을 모름) — 물량이 조정된 화면에선 어긋남을 힌트로 무마한다.
  const waterDelta =
    adjusted?.water_g != null && recipe.water_g !== null
      ? adjusted.water_g - recipe.water_g
      : 0;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-10">
      <header>
        <h1 className="text-xl font-semibold">커피 추출 도우미</h1>
        <p className="mt-1 text-sm opacity-70">
          구매하신 원두의 추천 레시피입니다. 결과에 따라 추출을 조정해 볼 수 있어요.
        </p>
      </header>

      <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
        <p className="text-xs font-medium uppercase tracking-wide opacity-60">
          {adjusted ? "오늘의 추천 레시피 · 지난 피드백 반영" : "오늘의 추천 레시피"}
        </p>
        <p className="mt-1 font-medium">{recipe.beanName}</p>
        {recipe.beanIntro && <p className="mt-1 text-sm opacity-70">{recipe.beanIntro}</p>}
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm opacity-80">
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </dl>
        {recipe.pour_text && (
          <div className="mt-2 border-t border-black/5 pt-2 text-sm opacity-80 dark:border-white/10">
            <p className="whitespace-pre-line">{recipe.pour_text}</p>
            {waterDelta !== 0 && (
              <p className="mt-1 text-xs opacity-70">
                {waterDelta > 0
                  ? `늘어난 물 ${waterDelta}g은 마지막 푸어에 더해 주세요.`
                  : `줄어든 물 ${-waterDelta}g은 마지막 푸어에서 빼 주세요.`}
              </p>
            )}
          </div>
        )}
        {lastSolution && (
          <p className="mt-2 text-sm font-medium">최근 솔루션: {lastSolution}</p>
        )}
        <a
          href={UNSPECIALTY_COMPASS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs underline opacity-60 hover:opacity-90"
        >
          내 분쇄도 측정하기 (언스페셜티 나침반) ↗
        </a>
      </section>

      {canGoBack && (
        <button
          onClick={back}
          className="-mb-2 self-start text-sm opacity-60 hover:opacity-90"
        >
          ← 뒤로
        </button>
      )}

      {result.kind === "ask" ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">{questionPrompt(result.question)}</h2>
          <div className="flex flex-col gap-2">
            {result.question.options.map((opt) => (
              <button
                key={opt}
                onClick={() => answer(result.question, opt)}
                className="rounded-lg border border-black/15 px-4 py-3 text-left hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                {LABEL[result.question.id][opt]}
              </button>
            ))}
          </div>
          <button
            onClick={() => setBailed(true)}
            className="mt-1 self-start text-sm underline opacity-60 hover:opacity-90"
          >
            잘 모르겠어요 — 도움 받기
          </button>
        </section>
      ) : (
        <section className="flex flex-col gap-3 rounded-xl bg-black/[0.03] p-5 dark:bg-white/[0.06]">
          <h2 className="font-semibold">{resultHeading(result.prescription)}</h2>
          <p className="text-lg">{describePrescription(result.prescription)}</p>
          <button
            onClick={reset}
            className="mt-2 self-start rounded-lg border border-black/15 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            처음부터
          </button>
        </section>
      )}
    </main>
  );
}
