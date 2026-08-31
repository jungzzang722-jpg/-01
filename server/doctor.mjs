/* =========================================================================
 * doctor.mjs — 고화질 합성이 왜 안 되는지 터미널에서 바로 알려준다
 *
 *     node server/doctor.mjs
 *     node server/doctor.mjs http://localhost:8787
 *
 * 브라우저의 fetch 는 실패 이유를 알려주지 않는다. 서버가 꺼졌든, 포트가
 * 틀렸든, IPv6 로 못 붙었든, CORS 든 — 전부 똑같은 "연결하지 못했습니다"다.
 * 그 화면만 보고는 어디를 고쳐야 할지 알 수 없다.
 *
 * 여기서는 브라우저를 거치지 않고 각 층을 따로 두드려, **어디까지 살아 있고
 * 어디서 끊겼는지**를 말한다.
 * ========================================================================= */
const PROXY = process.argv[2] || 'http://localhost:8787';
const ok = (s) => '  \x1b[32m✓\x1b[0m ' + s;
const no = (s) => '  \x1b[31m✗\x1b[0m ' + s;
const hint = (s) => '     \x1b[2m→ ' + s + '\x1b[0m';

async function get(url, ms = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    return { ok: r.ok, status: r.status, body: await r.text() };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, err: e.code || e.name || String(e.message || e) };
  }
}

console.log('\n고화질 합성 점검  ' + PROXY + '\n');

/* 1. 중계 서버 ─────────────────────────────────────────────────────────── */
let health = null;
const h = await get(PROXY.replace(/\/+$/, '') + '/health');
if (!h.ok) {
  console.log(no('중계 서버에 연결할 수 없습니다  (' + (h.err || 'HTTP ' + h.status) + ')'));
  console.log(hint('중계 서버를 켜셨나요?'));
  console.log(hint('VTON_PROVIDER=custom VTON_ENDPOINT=http://localhost:8788/tryon \\'));
  console.log(hint('  node server/vton-proxy.mjs'));
  console.log(hint('이미 켜져 있다면 그 터미널에 bind= 값이 무엇인지 보세요.'));
  console.log(hint('bind=0.0.0.0 인데 맥이라면 http://127.0.0.1:8787 로 주소를 바꿔 보세요.'));
  console.log('');
  process.exit(1);
}
try { health = JSON.parse(h.body); } catch { }
console.log(ok('중계 서버 살아 있음  provider=' + (health?.provider || '?')));
if (health?.quota) {
  console.log(ok('오늘 남은 횟수 ' + health.quota.left + '/' + health.quota.perDay));
}
if (health && health.provider !== 'custom' && !health.keySet) {
  console.log(no('API 키가 설정되지 않았습니다'));
  console.log(hint('VTON_API_KEY 를 넣고 다시 켜 주세요.'));
}

/* 2. CORS ─────────────────────────────────────────────────────────────────
 * 브라우저에서만 나타나는 실패다. 여기서 미리 잡아 준다. */
try {
  const pre = await fetch(PROXY.replace(/\/+$/, '') + '/compose', {
    method: 'OPTIONS',
    headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST',
               'Access-Control-Request-Headers': 'x-client-id' }
  });
  const allowOrigin = pre.headers.get('access-control-allow-origin');
  const allowHdr = (pre.headers.get('access-control-allow-headers') || '').toLowerCase();
  if (allowOrigin && (allowHdr.includes('x-client-id'))) {
    console.log(ok('CORS 설정 정상 (file:// 로 연 페이지도 허용)'));
  } else {
    console.log(no('CORS 가 막습니다  origin=' + allowOrigin + ' headers=' + allowHdr));
    console.log(hint('중계 서버가 오래된 버전일 수 있습니다. 다시 받아 주세요.'));
  }
} catch (e) {
  console.log(no('CORS 확인 실패: ' + e.message));
}

/* 3. 모델 서버 ─────────────────────────────────────────────────────────── */
const modelUrl = process.env.VTON_ENDPOINT
  ? process.env.VTON_ENDPOINT.replace(/\/tryon\/?$/, '') + '/health'
  : 'http://localhost:8788/health';
const m = await get(modelUrl);
if (!m.ok) {
  console.log(no('모델 서버에 연결할 수 없습니다  (' + (m.err || 'HTTP ' + m.status) + ')  ' + modelUrl));
  console.log(hint('VTON_MODE=mock python3 server/model/vton_server.py'));
} else {
  let mj = null;
  try { mj = JSON.parse(m.body); } catch { }
  console.log(ok('모델 서버 살아 있음  mode=' + (mj?.mode || '?') +
    (mj?.loaded ? '  모델 적재됨' : '')));
  if (mj?.mode === 'mock') {
    console.log(hint('지금은 모의 모드입니다 — 인물 사진이 그대로 돌아옵니다(정상).'));
    console.log(hint('결과 위에 빨간 MOCK 띠가 보이면 그 뜻입니다. 실제로 옷을 입히려면'));
    console.log(hint('CatVTON 을 설치하고 VTON_MODE=real 로 다시 띄워 주세요.'));
  }
  if (mj?.mode === 'real' && !mj.loaded) {
    console.log(no('모델이 올라오지 않았습니다: ' + (mj.error || '알 수 없음')));
    if (/torch|module/i.test(mj.error || '')) {
      console.log(hint('CatVTON 저장소의 INSTALL.md 대로 패키지를 설치해 주세요.'));
      console.log(hint('VTON_REPO_DIR 로 저장소 위치도 알려주셔야 합니다.'));
    }
  }
}

console.log('\n브라우저에 넣을 주소:  ' + PROXY + '\n');
