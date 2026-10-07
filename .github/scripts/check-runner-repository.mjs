import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const workspace = resolve(process.env.GITHUB_WORKSPACE);
// checkout's temporary HOME may hide its safe.directory setting from the action.
// Trust only this job's checked-out workspace, never all mounted repositories.
const before = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: workspace, encoding: 'utf8' });
if (before.status !== 0) console.log(`Git probe before workspace trust: ${before.stderr.trim()}`);
execFileSync('git', ['config', '--global', '--add', 'safe.directory', workspace]);
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
if (resolve(root) !== workspace) throw new Error('Git is outside the checked-out workspace');
console.log('Git workspace verified in the action runtime');
if (globalThis.Bun) {
  const { $ } = await import('bun');
  const shellRoot = (await $`git rev-parse --show-toplevel`.quiet().text()).trim();
  if (resolve(shellRoot) !== workspace) throw new Error('Bun Shell is outside the checked-out workspace');
  console.log('Git workspace verified in Bun Shell');
}
