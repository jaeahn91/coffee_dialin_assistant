// 피드백 열람: node --env-file=.env.local scripts/report-feedback.mjs [로스터명]
// 로스터명 생략 시 전체. QR별 퍼널(조회→세션→완주)과 피드백 상세(경로·규칙·조정)를 출력한다.
// 파일럿 운영용 읽기 전용 도구 — 쓰기 없음.
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL 필요 (.env.local)");
const roasterFilter = process.argv[2] ?? null;

const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const funnel = (await c.query(
    `select r.name as roaster, b.name as bean, q.code, q.status,
       (select count(*) from page_view v where v.qr_id = q.id)::int as views,
       (select count(*) from brew_session s where s.qr_id = q.id)::int as sessions,
       (select count(*) from feedback f join brew_session s on s.id = f.session_id
         where s.qr_id = q.id)::int as feedbacks
     from qr_code q
     join bean b on b.id = q.bean_id
     join roaster r on r.id = q.roaster_id
     where $1::text is null or r.name = $1
     order by r.name, b.name, q.issued_at`,
    [roasterFilter],
  )).rows;
  console.log(`QR 퍼널${roasterFilter ? ` — ${roasterFilter}` : " — 전체"}:`);
  console.table(funnel);

  const details = (await c.query(
    `select to_char(f.created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as at_kst,
       right(q.code, 4) as qr, f.satisfaction, f.path,
       coalesce(f.grid_cell, f.tree_leaf, '-') as rule,
       coalesce((select string_agg(m->>'variable' || ':' || (m->>'direction') ||
         case when m->>'magnitude' = 'slight' then '(조금)' else '' end, ' + ')
         from jsonb_array_elements(a.moves) m), '조정 없음') as moves,
       coalesce(a.before_snapshot->>'water_g' || '→' || (a.after_snapshot->>'water_g'), '-') as water,
       coalesce(a.before_snapshot->>'water_temp_c' || '→' || (a.after_snapshot->>'water_temp_c'), '-') as temp
     from feedback f
     join brew_session s on s.id = f.session_id
     join qr_code q on q.id = s.qr_id
     join roaster r on r.id = f.roaster_id
     left join adjustment a on a.feedback_id = f.id
     where $1::text is null or r.name = $1
     order by f.created_at`,
    [roasterFilter],
  )).rows;
  console.log("\n피드백 상세 (시각은 KST):");
  if (details.length === 0) console.log("  아직 없음");
  else console.table(details);
} finally {
  await c.end();
}
