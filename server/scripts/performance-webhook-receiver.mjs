import { createServer } from 'node:http';
const ids = new Set();
let active = 0, peak = 0, count = 0, duplicates = 0;
const server = createServer((req, res) => {
  active++; peak = Math.max(peak, active);
  res.once('close', () => active--);
  req.resume(); req.once('end', () => {
    count++;
    const id = req.headers['x-taskira-delivery'];
    if (ids.has(id)) duplicates++; ids.add(id);
    setTimeout(() => res.end('ok'), 50);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.send({ kind: 'ready', url: `http://127.0.0.1:${server.address().port}/hook` });
process.on('message', message => {
  if (message === 'stats') process.send({ kind: 'stats', count, duplicates, peak });
  if (message === 'reset') { ids.clear(); count = 0; duplicates = 0; peak = 0; process.send({ kind: 'reset' }); }
  if (message === 'close') { server.closeAllConnections(); server.close(() => process.exit(0)); }
});
