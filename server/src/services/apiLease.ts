import pg from "pg";

/** WS and auth invalidation are local: permit one serving process per database.
 * A dedicated session (not a pool checkout / transaction pooler) holds the lock. */
export async function acquireApiLease(databaseUrl: string, onLost: () => void): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: databaseUrl, application_name: "taskira-api-lease", keepAlive: true, connectionTimeoutMillis: 10_000 });
  let acquired = false;
  let stopping = false;
  const lost = () => {
    if (!acquired || stopping) return;
    stopping = true;
    onLost();
  };
  client.on("error", lost);
  client.on("end", lost);
  try {
    await client.connect();
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext('taskira:serving-api')) AS ok`,
    );
    if (!rows[0]?.ok) throw new Error("Taskira supports one API process per database; another API process is already serving this database");
    acquired = true;
  } catch (error) {
    stopping = true;
    await client.end().catch(() => undefined);
    throw error;
  }
  return async () => {
    stopping = true;
    await client.end(); // session closure releases the lock even after a crash
  };
}
