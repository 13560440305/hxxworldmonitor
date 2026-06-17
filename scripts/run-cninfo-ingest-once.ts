/**
 * Enqueue disclosure-ingest-cn and run executor once (dev helper).
 * Usage: npx tsx scripts/run-cninfo-ingest-once.ts [--symbols=600519,000001] [--lookback=7]
 */
import { loadEnvLocal } from '../packages/shared/src/load-env.js';
import pg from 'pg';

loadEnvLocal();

async function main(): Promise<void> {
  const { ensurePlatformDatabaseReady } = await import('../packages/platform-core/src/platform-db-startup.js');
  const { enqueuePlatformJob } = await import('../packages/platform-core/src/jobs/job-service.js');
  const { runExecutorOnce } = await import('../packages/platform-core/src/jobs/job-runner.js');
  const { createPlatformLogger } = await import('../packages/shared/src/platform-logger.js');

  const log = createPlatformLogger('run-cninfo-once');

  const args = process.argv.slice(2);
  const symbolsArg = args.find((a) => a.startsWith('--symbols='))?.split('=')[1];
  const lookbackArg = args.find((a) => a.startsWith('--lookback='))?.split('=')[1];

  const payload: Record<string, unknown> = {
    lookbackDays: lookbackArg ? Number(lookbackArg) : 7,
  };
  if (symbolsArg) {
    payload.symbols = symbolsArg.split(/[,，\s]+/).filter(Boolean);
  }

  await ensurePlatformDatabaseReady({ logger: log });

  const queued = await enqueuePlatformJob({
    handlerKey: 'disclosure-ingest-cn',
    payload,
  });
  console.log('Enqueued:', queued);

  const ran = await runExecutorOnce(`manual-${process.pid}`, log);
  console.log('Executor ran job:', ran);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const run = await pool.query(
      `SELECT status, stats_json, error_message FROM job_runs WHERE id = $1`,
      [queued.runId],
    );
    console.log('Run result:', JSON.stringify(run.rows[0], null, 2));

    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM listed_securities) AS listed,
        (SELECT COUNT(*)::int FROM company_filings WHERE source = 'cninfo') AS filings,
        (SELECT COUNT(*)::int FROM kg_edges) AS edges
    `);
    console.log('DB counts:', counts.rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
