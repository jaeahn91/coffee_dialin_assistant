"use client";

import { useEffect, useRef, useState } from "react";
import { describePrescription } from "@/lib/domain/describe";
import { flowStep, type FlowInput, type FlowQuestion, type FlowResult } from "@/lib/domain/flow";
import type { Prescription } from "@/lib/domain/types";
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
      return "조금 더 여쭤볼게요";
  }
}

function formatSeconds(s: number): string {
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (min === 0) return `${sec}초`;
  return sec === 0 ? `${min}분` : `${min}분 ${sec}초`;
}

function recipeLines(r: RecipeDisplay): string[] {
  const lines: string[] = [];
  if (r.dripper) lines.push(r.dripper);
  if (r.dose_g !== null) lines.push(`원두 ${r.dose_g}g`);
  if (r.water_g !== null) lines.push(`물 ${r.water_g}g`);
  if (r.water_temp_c !== null) lines.push(`물온도 ${r.water_temp_c}°C`);
  if (r.brew_time_min_s !== null && r.brew_time_max_s !== null)
    lines.push(`추출 ${formatSeconds(r.brew_time_min_s)}~${formatSeconds(r.brew_time_max_s)}`);
  else if (r.brew_time_min_s !== null || r.brew_time_max_s !== null)
    lines.push(`추출 ${formatSeconds((r.brew_time_min_s ?? r.brew_time_max_s)!)}`);
  if (r.grind_text) lines.push(`분쇄 ${r.grind_text}`);
  return lines;
}

export default function Flow({ code, recipe }: { code: string; recipe: RecipeDisplay }) {
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

  const canGoBack = bailed || history.length > 0;
  const lines = recipeLines(recipe);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-10">
      <header>
        <h1 className="text-xl font-semibold">커피 추출 도우미</h1>
        <p className="mt-1 text-sm opacity-70">
          구매하신 원두의 추천 레시피입니다. 결과에 따라 추출을 조정해 볼 수 있어요.
        </p>
      </header>

      <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
        <p className="text-xs font-medium uppercase tracking-wide opacity-60">오늘의 추천 레시피</p>
        <p className="mt-1 font-medium">{recipe.beanName}</p>
        {recipe.beanIntro && <p className="mt-1 text-sm opacity-70">{recipe.beanIntro}</p>}
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm opacity-80">
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </dl>
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
