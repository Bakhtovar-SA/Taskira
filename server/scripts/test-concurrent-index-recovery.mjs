#!/usr/bin/env node
/** Искусственно прерывает CREATE INDEX CONCURRENTLY, проверяет indisvalid=false
 * и выполняет тот же идемпотентный DROP INDEX CONCURRENTLY, который требуется
 * строкой recovery в нетранзакционных миграциях. */
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const schema = `concurrent_recovery_${process.pid}_${Date.now()}`;
const quotedSchema = `"${schema}"`;
const scopedUrl = new URL(databaseUrl);
scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);

const admin = new pg.Client({ connectionString: databaseUrl });
const builder = new pg.Client({ connectionString: scopedUrl.toString() });
const control = new pg.Client({ connectionString: scopedUrl.toString() });
let adminConnected = false;

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE SCHEMA ${quotedSchema}`);
  await builder.connect();
  await control.connect();
  await control.query(`CREATE TABLE recovery_probe (value integer NOT NULL)`);
  await control.query(`INSERT INTO recovery_probe SELECT n FROM generate_series(1, 20000) AS n`);
  await control.query(`
    CREATE FUNCTION slow_index_value(value integer) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE AS $$
    BEGIN
      PERFORM pg_sleep(0.0005);
      RETURN value;
    END $$
  `);

  const building = builder.query(
    `CREATE INDEX CONCURRENTLY recovery_interrupted_idx ON recovery_probe (slow_index_value(value))`,
  ).then(() => ({ completed: true, error: null }), (error) => ({ completed: false, error }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const cancelled = await control.query(`SELECT pg_cancel_backend($1) AS cancelled`, [builder.processID]);
  if (!cancelled.rows[0]?.cancelled) throw new Error("failed to cancel CREATE INDEX CONCURRENTLY");
  const buildResult = await building;
  if (buildResult.completed) throw new Error("CREATE INDEX CONCURRENTLY unexpectedly completed before cancellation");
  if (buildResult.error?.code !== "57014") throw buildResult.error;

  const invalid = await control.query(
    `SELECT i.indisvalid
       FROM pg_index i
      WHERE i.indexrelid = to_regclass('recovery_interrupted_idx')`,
  );
  if (invalid.rows.length !== 1 || invalid.rows[0].indisvalid !== false) {
    throw new Error(`cancelled build did not leave the expected invalid index: ${JSON.stringify(invalid.rows)}`);
  }

  await control.query(`DROP INDEX CONCURRENTLY IF EXISTS recovery_interrupted_idx`);
  const recovered = await control.query(`SELECT to_regclass('recovery_interrupted_idx') AS index_name`);
  if (recovered.rows[0]?.index_name !== null) throw new Error("recovery did not remove the interrupted index");
  console.log("concurrent index interruption/recovery passed");
} finally {
  await builder.end().catch(() => undefined);
  await control.end().catch(() => undefined);
  if (adminConnected) {
    await admin.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}
