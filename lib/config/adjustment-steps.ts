import type { Magnitude } from "../domain/types";

// [미결정] 부록5: 조정 폭·수렴 수치는 파일럿 데이터로 확정한다. 아래는 잠정 보수값(튜닝 노브).
// 값만 바꾸면 룰 엔진/표현을 건드리지 않고 처방 강도를 조정할 수 있다.
// 수렴 조건(§6-3): 목표 구간 폭 > 1스텝 폭 이어야 핑퐁 진동이 잡힌다 — 그 비교도 여기서 관리.
export const ADJUSTMENT_STEPS: Record<"grind" | "water" | "temp", Record<Magnitude, number>> = {
  grind: { slight: 1, standard: 2 }, // 그라인더 클릭(잠정). 표현 방식은 §6-4 미결정.
  water: { slight: 5, standard: 10 }, // g(잠정)
  temp: { slight: 1, standard: 2 }, // °C(잠정)
};
