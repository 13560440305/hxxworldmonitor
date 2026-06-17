import pg from 'pg';
import { loadEnvLocal } from '../packages/shared/src/load-env.ts';

loadEnvLocal();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const runs = await pool.query(`
    SELECT handler_key, status, error_message, stats_json, payload_json, finished_at
    FROM job_runs WHERE handler_key = 'disclosure-ingest-cn'
    ORDER BY scheduled_at DESC LIMIT 5`);
  console.log('=== disclosure-ingest-cn runs ===');
  console.log(JSON.stringify(runs.rows, null, 2));

  const recent = await pool.query(`
    SELECT handler_key, status, stats_json, finished_at
    FROM job_runs ORDER BY scheduled_at DESC LIMIT 10`);
  console.log('\n=== recent runs (all handlers) ===');
  for (const r of recent.rows) {
    const msg = r.stats_json?.message ?? r.stats_json?.status ?? '';
    console.log(r.handler_key, r.status, msg?.slice?.(0, 80) ?? JSON.stringify(r.stats_json)?.slice(0, 80));
  }

  const listed = await pool.query('SELECT COUNT(*)::int AS n FROM listed_securities');
  const filings = await pool.query("SELECT COUNT(*)::int AS n FROM company_filings WHERE source = 'cninfo'");
  const kg = await pool.query("SELECT COUNT(*)::int AS n FROM kg_entities WHERE entity_type IN ('company','filing')");
  console.log('\n=== data counts ===', {
    listed_securities: listed.rows[0].n,
    cninfo_filings: filings.rows[0].n,
    kg_entities: kg.rows[0].n,
  });

  const sample = await pool.query(`
    SELECT symbol, name, market, exchange FROM listed_securities ORDER BY updated_at DESC LIMIT 5`);
  console.log('\n=== listed_securities sample ===');
  console.log(sample.rows);

  const cninfo = await pool.query("SELECT slug, enabled, base_url FROM integration_providers WHERE slug = 'cninfo'");
  console.log('\n=== cninfo provider ===', cninfo.rows[0]);

  const binding = await pool.query("SELECT * FROM data_source_ingest_bindings WHERE source_slug = 'cninfo'");
  console.log('=== ingest binding ===', binding.rows[0]);

  const pending = await pool.query("SELECT handler_key, status, scheduled_at FROM job_runs WHERE status = 'pending' ORDER BY scheduled_at LIMIT 5");
  console.log('\n=== pending jobs ===', pending.rows);

  const running = await pool.query(`
    SELECT id, handler_key, started_at, locked_until, locked_by, payload_json
    FROM job_runs WHERE status = 'running' ORDER BY started_at`);
  console.log('\n=== running jobs (block concurrency) ===', running.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
