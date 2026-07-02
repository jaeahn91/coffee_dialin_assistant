// 랜딩(§5 밖): 서비스 진입은 봉지 QR(/r/[code])로 이루어진다. 목업 레시피는
// b422610에서 쓰던 것 — 실제 연결(ADR-001)로 대체되어 제거했다.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-5 py-10">
      <h1 className="text-xl font-semibold">커피 추출 도우미</h1>
      <p className="text-sm opacity-70">
        원두 봉지의 QR 코드를 스캔하면 로스터가 준비한 추천 레시피와 추출 조정 도우미가
        열립니다.
      </p>
    </main>
  );
}
