import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run.ts', import.meta.url));
test('默认烟雾预览不读取凭据也不启动浏览器', () => {
  const text = execFileSync(process.execPath, ['--experimental-strip-types', runner, '--smoke'], {
    encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: '/不存在的凭据目录', PLAYWRIGHT_BROWSERS_PATH: '/不存在的浏览器' },
  });
  const report = JSON.parse(text);
  assert.equal(report.status, 'dry-run');
  assert.equal(report.plannedRequests, 1);
  assert.equal(report.productionReady, false);
  assert.equal(report.productionPermissionUIValidated, false);
});

test('未知参数在启动浏览器或读取凭据前拒绝且只打印固定错误', () => {
  let output = '';
  try { execFileSync(process.execPath, ['--experimental-strip-types', runner, '--invalid'], { encoding: 'utf8' }); }
  catch (error) { output = (error as { stdout: string }).stdout; }
  assert.equal(JSON.parse(output).failure, 'INVALID_ARGUMENT');
  assert.equal(output.includes('apiKey'), false);
});
