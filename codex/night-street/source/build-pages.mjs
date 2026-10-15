import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  cwd: new URL('.', import.meta.url),
  env: { ...process.env, NIGHT_STREET_PAGES: '1', NEXT_TELEMETRY_DISABLED: '1' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
