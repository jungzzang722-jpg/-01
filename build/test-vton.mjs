/* 고화질 합성 경로를 끝에서 끝까지 돌린다.
 *
 * 진짜 공급자를 부르지 않는다 — 돈이 들고, 결과가 매번 다르고, 네트워크가
 * 없으면 테스트가 죽는다. 대신 공급자 자리에 가짜 서버를 세워 **배선**을
 * 검증한다: 무엇이 나가는가, 캐시가 도는가, 실패하면 어떻게 되는가.
 *
 * 그리고 가장 중요한 것 하나 — 원본 파일에 네트워크 코드가 한 줄도 없다는
 * 불변식을 여기서 지킨다. 그게 깨지면 이 앱의 약속이 깨진다.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT_STUB = 8791, PORT_PROXY = 8792;
let fail = 0;
function check(ok, ko, extra) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + ko + (extra ? '  — ' + extra : ''));
  if (!ok) fail++;
}

/* ── 1. 원본에 네트워크 코드가 없는가 ─────────────────────────────────── */
console.log('■ 원본 파일의 불변식');
const plain = fs.readFileSync('퍼스널컬러진단.html', 'utf8');
const hq = fs.readFileSync('퍼스널컬러진단_고화질합성.html', 'utf8');
for (const [pat, ko] of [
  [/\bfetch\s*\(/, 'fetch'], [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'], [/navigator\.sendBeacon/, 'sendBeacon'],
  [/\bEventSource\b/, 'EventSource']
]) {
  check(!pat.test(plain), '원본에 ' + ko + ' 없음');
}
check(/\bfetch\s*\(/.test(hq), '고화질판에는 fetch 있음');
check(hq.includes('global.VTON'), '고화질판에 VTON 모듈 포함');
check(!plain.includes('global.VTON'), '원본에는 VTON 모듈 없음');

/* ── 2. 가짜 공급자 ────────────────────────────────────────────────────
 * 받은 인물 이미지를 그대로 돌려주되, 무엇을 받았는지 기록한다. */
const seen = [];
const stub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const ct = req.headers['content-type'] || '';
  seen.push({ bytes: buf.length, hasPerson: buf.includes(Buffer.from('name="person"')),
              hasGarment: buf.includes(Buffer.from('name="garment"')), ct });
  // person 파트의 PNG 를 잘라 그대로 돌려준다 (합성한 척)
  const i = buf.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const png = i >= 0 ? buf.slice(i) : Buffer.alloc(0);
  res.writeHead(200, { 'Content-Type': 'image/png' });
  res.end(png);
});
await new Promise((r) => stub.listen(PORT_STUB, r));

/* ── 3. 중계 서버 ─────────────────────────────────────────────────────── */
const proxy = spawn(process.execPath, ['server/vton-proxy.mjs'], {
  env: { ...process.env, PORT: String(PORT_PROXY), VTON_PROVIDER: 'custom',
         VTON_ENDPOINT: `http://127.0.0.1:${PORT_STUB}/`, VTON_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
proxy.stderr.on('data', (d) => console.log('  [proxy] ' + String(d).trim()));
await new Promise((r) => proxy.stdout.once('data', r));

console.log('\n■ 중계 서버');
const health = await (await fetch(`http://127.0.0.1:${PORT_PROXY}/health`)).json();
check(health.ok === true, '/health 응답', 'provider=' + health.provider);
check(!('key' in health) && !JSON.stringify(health).includes('secret'), '키를 노출하지 않음');

/* ── 4. 브라우저에서 끝까지 ──────────────────────────────────────────── */
console.log('\n■ 클라이언트 → 중계 → 공급자');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + path.resolve('퍼스널컬러진단_고화질합성.html'));
await page.waitForFunction(() => window.VTON && window.TRYON);
const fx = fs.readFileSync('build/fixture-photo.js', 'utf8');

const r = await page.evaluate(async ({ fx, url }) => {
  const cv = new Function(fx + '; return person;')()().canvas;
  const body = TRYON.prepare(BODY.analyzeFull(cv, { gender: 'male' }), cv, 760);
  const layers = [{ garmentId: 'b-straight-denim', colorHex: '#3A4A63' },
                  { garmentId: 't-crew-cotton', colorHex: '#8B2D48' }];
  const out = {};

  // 주소가 없으면 꺼져 있어야 한다
  VTON.setEndpoint('');
  out.offWhenUnset = !VTON.enabled();
  out.offResult = await VTON.compose(body, layers, {});

  VTON.setEndpoint(url);
  out.enabled = VTON.enabled();

  // 동의 전에는 보내지 않아야 한다
  VTON.setConsent(false);
  out.beforeConsent = await VTON.compose(body, layers, {});

  VTON.setConsent(true);
  await VTON.clearCache();
  const stages = [];
  const t0 = performance.now();
  const first = await VTON.compose(body, layers, { onStage: (s) => stages.push(s) });
  out.first = { ok: first.ok, cached: !!first.cached, ko: first.ko || null,
                len: first.dataUrl ? first.dataUrl.length : 0, stages };
  out.firstMs = Math.round(performance.now() - t0);

  const t1 = performance.now();
  const second = await VTON.compose(body, layers, {});
  out.second = { ok: second.ok, cached: !!second.cached };
  out.secondMs = Math.round(performance.now() - t1);

  // 보내는 인물 이미지에 배경이 없어야 한다
  const pc = VTON.personPayload(body, 512);
  const pd = pc.getContext('2d').getImageData(0, 0, pc.width, pc.height).data;
  let opaque = 0, corner = 0;
  for (let i = 3; i < pd.length; i += 4) if (pd[i] > 200) opaque++;
  for (const [x, y] of [[2, 2], [pc.width - 3, 2], [2, pc.height - 3], [pc.width - 3, pc.height - 3]]) {
    if (pd[(y * pc.width + x) * 4 + 3] > 40) corner++;
  }
  out.payload = { w: pc.width, h: pc.height, opaqueRatio: +(opaque / (pc.width * pc.height)).toFixed(3), corner };
  return out;
}, { fx, url: `http://127.0.0.1:${PORT_PROXY}` });

check(r.offWhenUnset, '주소가 없으면 기능이 꺼짐');
check(r.offResult.off === true, '꺼진 상태에서 호출하면 off 로 응답');
check(r.enabled, '주소를 넣으면 켜짐');
check(r.beforeConsent.needConsent === true, '동의 전에는 전송하지 않음');
check(r.first.ok === true, '첫 호출 성공', r.first.ko || (r.first.len + 'B'));
check(!r.first.cached, '첫 호출은 캐시 미스');
check(r.second.ok === true && r.second.cached === true, '두 번째는 캐시 적중');
check(r.secondMs < r.firstMs, '캐시가 실제로 빠름', r.firstMs + 'ms → ' + r.secondMs + 'ms');
check(r.payload.corner === 0, '보내는 이미지의 네 모서리가 투명(배경 제거됨)');
check(r.payload.opaqueRatio > 0.05 && r.payload.opaqueRatio < 0.6,
  '인물이 적당한 면적을 차지', r.payload.opaqueRatio);

console.log('\n■ 공급자가 실제로 받은 것');
check(seen.length >= 2, '옷 벌수만큼 호출됨', seen.length + '회');
check(seen.every((s) => s.hasPerson), '매 호출에 인물 포함');
check(seen.every((s) => s.hasGarment), '매 호출에 옷 포함');
seen.forEach((s, i) => console.log('    ' + (i + 1) + '회차 ' + (s.bytes / 1024).toFixed(0) + 'KB'));

console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await browser.close();
proxy.kill();
stub.close();
console.log('\n' + (fail ? '실패 ' + fail + '건' : '전부 통과'));
process.exit(fail ? 1 : 0);
