import pg from "pg";

/** WS and auth invalidation are local: permit one serving process per database.
 * A dedicated session (not a pool checkout / transaction pooler) holds the lock. */
export async function acquireApiLease(databaseUrl: string, onLost: () => void, heartbeatIntervalMs = 10_000): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: databaseUrl, application_name: "taskira-api-lease", keepAlive: true, connectionTimeoutMillis: 10_000, query_timeout: 5_000 });
  let acquired = false;
  let stopping = false;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  const lost = () => {
    if (!acquired || stopping) return;
    stopping = true;
    clearTimeout(heartbeat);
    onLost();
  };
  const scheduleHeartbeat = () => {
    heartbeat = setTimeout(() => {
      void client.query("SELECT 1").then(() => {
        if (!stopping) scheduleHeartbeat();
      }, lost); // An uncertain session must stop serving before a replacement takes ownership.
    }, heartbeatIntervalMs);
    heartbeat.unref();
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
    scheduleHeartbeat();
  } catch (error) {
    stopping = true;
    await client.end().catch(() => undefined);
    throw error;
  }
  return async () => {
    stopping = true;
    clearTimeout(heartbeat);
    await client.end(); // session closure releases the lock even after a crash
  };
}
