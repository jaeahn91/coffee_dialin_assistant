"use client";

import { useEffect, useRef, useState } from "react";
import { describeMove, describePrescription, LIMIT_NOTICES } from "@/lib/domain/describe";
import { flowStep, type FlowInput, type FlowQuestion, type FlowResult } from "@/lib/domain/flow";
import type { Move, Prescription } from "@/lib/domain/types";
import { UNSPECIALTY_COMPASS_URL } from "@/lib/config/links";
import { startSessionAction, submitFeedbackAction, type SubmitResult } from "./actions";
import type { StartSessionResult } from "@/lib/db/sessions";
import type { LimitedVariable } from "@/lib/server/derive";

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

// 서버가 기록을 마친 조정의 확정본. 경계 가드(ADR-003)로 클라이언트 계산과 달라질 수
// 있어, 도착하면 결과 화면을 이것으로 갈아끼운다(무효화된 move 제거 + 고정 문구).
type ServerOutcome = { moves: Move[]; limited: LimitedVariable[] };

function resultPanel(
  p: Prescription,
  outcome: ServerOutcome | null,
): { heading: string; body: string | null; notices: string[]; tone: "positive" | "accent" | "neutral" } {
  if (p.kind === "adjust" && outcome) {
    const body = outcome.moves.length
      ? outcome.moves.map(describeMove).join(" + ")
      : null;
    return {
      heading: body ? resultHeading(p) : "자동 조정이 한계에 닿았어요",
      body,
      notices: outcome.limited.map((v) => LIMIT_NOTICES[v]),
      tone: body ? "accent" : "neutral",
    };
  }
  return {
    heading: resultHeading(p),
    body: describePrescription(p),
    notices: [],
    tone: p.kind === "hold" ? "positive" : p.kind === "adjust" ? "accent" : "neutral",
  };
}

const PANEL_TONE = {
  positive: { section: "bg-positive-soft", heading: "text-positive" },
  accent: { section: "bg-accent-soft", heading: "text-accent" },
  neutral: { section: "border border-line bg-card", heading: "" },
} as const;

function formatSeconds(s: number): string {
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (min === 0) return `${sec}초`;
  return sec === 0 ? `${min}분` : `${min}분 ${sec}초`;
}

// 레시피 카드 한 칸. 조정값이 있고 기준과 다르면 값을 액센트로, 기준을 주석으로(ADR-002).
type RecipeRow = { label: string; value: string; note?: string; adjusted?: boolean; wide?: boolean };

function numRow(
  label: string,
  unit: string,
  base: number | null,
  adjusted: number | null | undefined,
): RecipeRow | null {
  const value = adjusted ?? base;
  if (value === null) return null;
  if (adjusted != null && base !== null && adjusted !== base)
    return { label, value: `${adjusted}${unit}`, note: `기준 ${base}${unit}`, adjusted: true };
  return { label, value: `${value}${unit}` };
}

function recipeRows(r: RecipeDisplay, adj: AdjustedParams | null): RecipeRow[] {
  const rows: (RecipeRow | null)[] = [];
  if (r.dripper) rows.push({ label: "드리퍼", value: r.dripper });
  rows.push(numRow("원두", "g", r.dose_g, adj?.dose_g));
  rows.push(numRow("물", "g", r.water_g, adj?.water_g));
  rows.push(numRow("물온도", "°C", r.water_temp_c, adj?.water_temp_c));
  if (r.brew_time_min_s !== null && r.brew_time_max_s !== null)
    rows.push({
      label: "추출 시간",
      value: `${formatSeconds(r.brew_time_min_s)}~${formatSeconds(r.brew_time_max_s)}`,
    });
  else if (r.brew_time_min_s !== null || r.brew_time_max_s !== null)
    rows.push({
      label: "추출 시간",
      value: formatSeconds((r.brew_time_min_s ?? r.brew_time_max_s)!),
    });
  if (r.grind_text)
    rows.push({
      label: "분쇄",
      value: `${r.grind_text}${r.grind_um !== null ? ` (약 ${r.grind_um}µm)` : ""}`,
      wide: true,
    });
  else if (r.grind_um !== null) rows.push({ label: "분쇄", value: `약 ${r.grind_um}µm`, wide: true });
  return rows.filter((row): row is RecipeRow => row !== null);
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
  // 이번 방문에서 기록된 조정 — 완주 직후부터 카드가 최신 사슬을 보여준다("처음부터"로
  // 돌아와도 유지). 서버 응답의 after/moves를 그대로 반영하므로 페이지 재조회와 동치.
  // lastSolution이 null이면(전부 경계 무효화) 직전 값을 유지한다 — 이번엔 바뀐 게 없다.
  const [live, setLive] = useState<{
    adjusted: AdjustedParams;
    lastSolution: string | null;
  } | null>(null);
  // 결과 화면용 서버 확정본 — "처음부터"로 리셋되면 비운다(재완주는 기록되지 않으므로).
  const [outcome, setOutcome] = useState<ServerOutcome | null>(null);

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
      else if (r.applied) {
        setOutcome({ moves: r.applied.moves, limited: r.applied.limited });
        setLive({
          adjusted: {
            dose_g: r.applied.after.dose_g,
            water_g: r.applied.after.water_g,
            water_temp_c: r.applied.after.water_temp_c,
          },
          lastSolution: r.applied.moves.length
            ? r.applied.moves.map(describeMove).join(" + ")
            : null,
        });
      }
    })();
  }, [result.kind, bailed, code, input]);

  const reset = () => {
    setInput({});
    setHistory([]);
    setBailed(false);
    setOutcome(null);
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
  const panel = result.kind === "ask" ? null : resultPanel(result.prescription, outcome);
  const effAdjusted = live?.adjusted ?? adjusted;
  const effSolution = live?.lastSolution ?? lastSolution;
  const rows = recipeRows(recipe, effAdjusted);
  // 붓기 텍스트는 박제(총량 조정을 모름) — 물량이 조정된 화면에선 어긋남을 힌트로 무마한다.
  const waterDelta =
    effAdjusted?.water_g != null && recipe.water_g !== null
      ? effAdjusted.water_g - recipe.water_g
      : 0;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          커피 추출 도우미
        </p>
        <h1 className="mt-1.5 text-xl font-bold leading-snug tracking-tight">
          {recipe.beanName}
        </h1>
        {recipe.beanIntro && (
          <p className="mt-1 text-sm leading-relaxed text-muted">{recipe.beanIntro}</p>
        )}
      </header>

      <section className="rounded-2xl border border-line bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            오늘의 추천 레시피
          </p>
          {effAdjusted && (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium leading-none text-accent">
              지난 피드백 반영
            </span>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {rows.map((row) => (
            <div key={row.label} className={row.wide ? "col-span-2" : undefined}>
              <dt className="text-xs text-muted">{row.label}</dt>
              <dd
                className={`mt-0.5 text-[15px] font-semibold ${row.adjusted ? "text-accent" : ""}`}
              >
                {row.value}
                {row.note && (
                  <span className="ml-1.5 text-xs font-normal text-muted">{row.note}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {recipe.pour_text && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-xs text-muted">붓기</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{recipe.pour_text}</p>
            {waterDelta !== 0 && (
              <p className="mt-1.5 text-xs leading-relaxed text-accent">
                {waterDelta > 0
                  ? `늘어난 물 ${waterDelta}g은 마지막 푸어에 더해 주세요.`
                  : `줄어든 물 ${-waterDelta}g은 마지막 푸어에서 빼 주세요.`}
              </p>
            )}
          </div>
        )}
        {effSolution && (
          <p className="mt-4 rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm font-medium text-accent">
            최근 솔루션 · {effSolution}
          </p>
        )}
        <a
          href={UNSPECIALTY_COMPASS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-xs text-muted underline underline-offset-4 hover:text-accent"
        >
          내 분쇄도 측정하기 (언스페셜티 사이트) ↗
        </a>
      </section>

      {canGoBack && (
        <button
          onClick={back}
          className="-mb-2 self-start text-sm text-muted transition-colors hover:text-foreground"
        >
          ← 뒤로
        </button>
      )}

      {result.kind === "ask" ? (
        <section className="flex flex-col gap-3.5">
          <h2 className="text-lg font-bold tracking-tight">{questionPrompt(result.question)}</h2>
          <div className="flex flex-col gap-2">
            {result.question.options.map((opt) => (
              <button
                key={opt}
                onClick={() => answer(result.question, opt)}
                className="min-h-12 rounded-xl border border-line bg-card px-4 py-3 text-left text-[15px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:border-accent/50 active:bg-accent-soft"
              >
                {LABEL[result.question.id][opt]}
              </button>
            ))}
          </div>
          <button
            onClick={() => setBailed(true)}
            className="self-start text-sm text-muted underline underline-offset-4 transition-colors hover:text-accent"
          >
            잘 모르겠어요 — 도움 받기
          </button>
        </section>
      ) : (
        panel && (
          <section className={`flex flex-col gap-2.5 rounded-2xl p-5 ${PANEL_TONE[panel.tone].section}`}>
            <h2 className={`font-bold ${PANEL_TONE[panel.tone].heading}`}>{panel.heading}</h2>
            {panel.body && <p className="text-lg font-semibold leading-relaxed">{panel.body}</p>}
            {panel.notices.map((n) => (
              <p key={n} className="text-sm leading-relaxed text-muted">
                {n}
              </p>
            ))}
            <button
              onClick={reset}
              className="mt-2 self-start rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-accent/50"
            >
              처음부터
            </button>
          </section>
        )
      )}
    </main>
  );
}
