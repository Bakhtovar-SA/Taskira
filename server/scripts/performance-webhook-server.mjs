import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root = process.env.PERF_SERVER_ROOT;
const db = await import(pathToFileURL(join(root, 'src/db.ts')));
db.initPool(process.env.DATABASE_URL);
await db.migrate();
const config = await import(pathToFileURL(join(root, 'src/config.ts')));
config.initConfig();
const guard = await import(pathToFileURL(join(root, 'src/services/egress.ts')));
guard._allowLoopbackForTests(true);
const dispatch = await import(pathToFileURL(join(root, 'src/services/webhookDispatch.ts')));
const { buildApp } = await import(pathToFileURL(join(root, 'src/app.ts')));
const app = buildApp();
const url = await app.listen({ host: '127.0.0.1', port: 0 });
process.send({ kind: 'ready', url });
process.on('message', async message => {
  if (message === 'fanout') {
    while (await dispatch.fanOut()) {}
    process.send({ kind: 'fanout' });
  }
  if (message === 'drain') {
    const started = performance.now(), cpu = process.cpuUsage();
    let ticks = 0;
    for (;;) {
      await dispatch.runWebhookDispatchOnce(); ticks++;
      const [queue] = await db.q("SELECT count(*)::int AS n FROM webhook_deliveries WHERE state IN ('pending','sending')");
      if (!queue.n) break;
      if (performance.now() - started > 300000) throw new Error('Drain deadline exceeded');
      await new Promise(resolve => setTimeout(resolve, config.loadConfig().webhooks.pollMs));
    }
    process.send({ kind: 'drained', elapsedMs: performance.now() - started, cpu: process.cpuUsage(cpu), ticks });
  }
  if (message === 'close') {
    await dispatch.stopWebhookDispatch(); await app.close(); await db.closePool(); process.exit(0);
  }
});
