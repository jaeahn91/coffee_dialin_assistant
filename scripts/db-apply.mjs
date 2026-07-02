// 마이그레이션 적용: node --env-file=.env.local scripts/db-apply.mjs <sql파일...>
// Supabase CLI 없이 SUPABASE_DB_URL(Session pooler)로 직접 적용한다.
// 파일 하나 = 트랜잭션 하나(실패 시 그 파일 전체 롤백). 이미 적용된 스키마 위에
// 0001을 다시 실행하는 실수는 roaster 테이블 존재 여부로 막는다.
import { readFileSync } from "node:fs";
import pg from "pg";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("사용법: node --env-file=.env.local scripts/db-apply.mjs <sql파일...>");
  process.exit(1);
}
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("SUPABASE_DB_URL 환경변수가 필요합니다 (.env.local).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows: [v] } = await client.query("select current_setting('server_version_num')::int as n, version() as v");
  console.log("서버:", v.v.split(" on ")[0]);
  if (v.n < 150000) {
    throw new Error("PostgreSQL 15+ 필요 (복합 FK의 on delete set null (컬럼) 문법)");
  }

  for (const file of files) {
    if (file.includes("0001_init")) {
      const { rows: [{ exists }] } = await client.query(
        "select to_regclass('public.roaster') is not null as exists",
      );
      if (exists) {
        console.log(`skip: ${file} — roaster 테이블이 이미 존재(적용됨)`);
        continue;
      }
    }
    const sql = readFileSync(file, "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("commit");
      console.log(`적용됨: ${file}`);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`${file} 실패 → 롤백: ${e.message}`);
    }
  }
} finally {
  await client.end();
}
