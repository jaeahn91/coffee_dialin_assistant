-- 0003_grind_um.sql — ADR-002: 기준 분쇄도 µm 선택 병기 + 재스캔 표시용 읽기 함수

-- 기준 분쇄도(µm, 선택). 로스터가 모르면 null → 표시 생략. 언스페셜티 나침반으로 실측 가능.
alter table recipe add column grind_um numeric;

-- 재스캔 표시용: 이 QR 사슬의 최신 조정. start_brew_session(0002)의 사슬 연결 쿼리와
-- 같은 논리 — 화면에 보여주는 조정과 다음 세션이 잇는 조정이 반드시 일치해야 한다(ADR-002).
create or replace function latest_adjustment_for_qr(p_qr_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'after_snapshot', a.after_snapshot,
    'moves', a.moves,
    'created_at', a.created_at
  )
  from adjustment a
  join brew_session s on s.id = a.session_id
  where s.qr_id = p_qr_id
  order by a.created_at desc
  limit 1
$$;

revoke execute on function latest_adjustment_for_qr(uuid) from public, anon, authenticated;
