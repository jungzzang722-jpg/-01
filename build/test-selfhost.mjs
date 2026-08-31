/* 직접 구동 구성을 끝에서 끝까지 돌린다.
 *
 *   브라우저 → 중계 서버(Node) → 모델 서버(Python) → 다시 브라우저
 *
 * GPU 가 없어도 배선을 검증할 수 있어야 한다. 모델을 붙인 뒤 문제가 생기면
 * "배선은 이미 됐었다"는 사실이 원인을 절반으로 좁혀 준다. 그래서 모델 서버는
 * 모의 모드로 띄우고, 나머지는 전부 진짜를 쓴다.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT_MODEL = 8795, PORT_PROXY = 8796;
let fail = 0;
const check = (ok, ko, extra) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + ko + (extra ? '  — ' + extra : ''));
  if (!ok) fail++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 모델 서버 (Python, 모의 모드) ─────────────────────────────────────── */
const model = spawn('python3', ['server/model/vton_server.py'], {
  env: { ...process.env, PORT: String(PORT_MODEL), VTON_MODE: 'mock', VTON_MOCK_DELAY: '0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
model.stderr.on('data', (d) => console.log('  [model] ' + String(d).trim()));
await new Promise((r) => model.stdout.once('data', r));
await wait(300);

console.log('■ 모델 서버 (Python)');
const mh = await (await fetch(`http://127.0.0.1:${PORT_MODEL}/health`)).json();
check(mh.ok === true, '/health 응답', 'mode=' + mh.mode + ' model=' + mh.model);
check(mh.mode === 'mock', '모의 모드로 떠 있음');

/* ── 중계 서버 (Node) — custom 공급자로 모델 서버를 가리킨다 ──────────── */
const proxy = spawn(process.execPath, ['server/vton-proxy.mjs'], {
  env: { ...process.env, PORT: String(PORT_PROXY), VTON_PROVIDER: 'custom',
         VTON_ENDPOINT: `http://127.0.0.1:${PORT_MODEL}/tryon`, VTON_API_KEY: '',
         VTON_QUOTA_PER_DAY: '5' },
  stdio: ['ignore', 'pipe', 'pipe']
});
proxy.stderr.on('data', (d) => console.log('  [proxy] ' + String(d).trim()));
await new Promise((r) => proxy.stdout.once('data', r));

console.log('\n■ 중계 서버 (Node)');
const ph = await (await fetch(`http://127.0.0.1:${PORT_PROXY}/health`)).json();
check(ph.ok === true, '/health 응답', 'provider=' + ph.provider);
check(ph.quota && ph.quota.perDay === 5, '한도 5벌/일');
check(!JSON.stringify(ph).toLowerCase().includes('key"'), '키를 노출하지 않음');

/* ── 브라우저 ─────────────────────────────────────────────────────────── */
console.log('\n■ 브라우저 → 중계 → 모델');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + path.resolve('퍼스널컬러진단_고화질합성.html'));
await page.waitForFunction(() => window.VTON && window.TRYON);
const fx = fs.readFileSync('build/fixture-photo.js', 'utf8');

const r = await page.evaluate(async ({ fx, url }) => {
  const cv = new Function(fx + '; return person;')()().canvas;
  const body = TRYON.prepare(BODY.analyzeFull(cv, { gender: 'male' }), cv, 760);
  VTON.setEndpoint(url); VTON.setConsent(true);
  await VTON.clearCache();
  const stages = [];
  const res = await VTON.compose(body, [
    { garmentId: 'b-straight-denim', colorHex: '#3A4A63' },
    { garmentId: 't-crew-cotton', colorHex: '#8B2D48' }
  ], { onStage: (s) => stages.push(s) });
  return { ok: res.ok, ko: res.ko || null, len: res.dataUrl ? res.dataUrl.length : 0,
           quota: res.quota || null, stages, ms: res.ms };
}, { fx, url: `http://127.0.0.1:${PORT_PROXY}` });

check(r.ok === true, '합성 성공', r.ko || (Math.round(r.len / 1024) + 'KB · ' + r.ms + 'ms'));
check(r.quota && r.quota.left === 4, '한도가 1 줄어듦', r.quota ? r.quota.left + '/5' : '없음');
check(r.stages.length >= 2, '진행 단계를 알려줌', r.stages.join(' → '));

/* ── 모델이 아직 없을 때 무슨 일이 생기는가 ──────────────────────────── */
console.log('\n■ 모델을 아직 안 붙였을 때 (real 모드)');
const real = spawn('python3', ['server/model/vton_server.py'], {
  env: { ...process.env, PORT: String(PORT_MODEL + 10), VTON_MODE: 'real' },
  stdio: ['ignore', 'pipe', 'pipe']
});
/* 서버가 안 뜨면 여기서 영원히 기다리게 된다. 실제로 그렇게 멈춘 적이 있다 —
 * torch 가 없어 load_model 이 ImportError 를 냈는데 시작 코드가
 * NotImplementedError 만 잡고 있었다. 테스트가 매달리지 않게 시한을 둔다. */
const realUp = await Promise.race([
  new Promise((r) => real.stdout.on('data', (d) => { if (String(d).includes('http://')) r(true); })),
  wait(15000).then(() => false)
]);
check(realUp, 'real 모드에서도 서버가 뜸 (모델 적재 실패해도)');
await wait(300);
const fd = new FormData();
fd.append('person', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'p.png');
fd.append('category', 'top');
const rr = await fetch(`http://127.0.0.1:${PORT_MODEL + 10}/tryon`, { method: 'POST', body: fd });
const rj = await rr.json();
check(rr.status === 503 || rr.status === 501, '왜 안 되는지를 상태 코드로 알려줌', String(rr.status));
check(/설치|mock/.test(rj.ko || ''), '무엇을 하면 되는지 알려줌', (rj.ko || '').slice(0, 60));
const rh = await (await fetch(`http://127.0.0.1:${PORT_MODEL + 10}/health`)).json();
check(rh.ok === true && rh.loaded === false, '/health 가 살아 있고 미적재를 보고');
check(!!rh.error, '/health 가 실패 이유를 담고 있음', (rh.error || '').slice(0, 50));
real.kill();

console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await browser.close();
proxy.kill(); model.kill();
console.log('\n' + (fail ? '실패 ' + fail + '건' : '전부 통과'));
process.exit(fail ? 1 : 0);
