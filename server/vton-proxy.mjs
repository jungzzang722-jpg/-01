/* =========================================================================
 * vton-proxy.mjs — 고화질 합성 중계 서버
 *
 * 왜 서버가 필요한가.
 *   이 앱은 더블클릭으로 열리는 HTML 한 개다. 거기에 API 키를 넣으면 파일을
 *   받은 사람 누구나 키를 꺼내 쓸 수 있다. 키는 반드시 서버에 있어야 한다.
 *   그것이 이 파일이 존재하는 유일한 이유다 — 그 외의 일은 하지 않는다.
 *
 * 의존성이 없다. Node 18+ 의 내장 fetch 와 http 만 쓴다.
 *   node server/vton-proxy.mjs
 *
 * 환경변수
 *   VTON_PROVIDER   openai | replicate | custom      (기본 openai)
 *   VTON_API_KEY    공급자 API 키                     (필수)
 *   VTON_MODEL      모델 이름 — 공급자 문서에서 확인해 넣는다
 *   VTON_ENDPOINT   custom 일 때 호출할 주소
 *   PORT            기본 8787
 *   ALLOW_ORIGIN    CORS 허용 오리진 (기본 * — 로컬에서만 쓸 때)
 *
 * ⚠ 모델 이름과 엔드포인트는 공급자마다 다르고 자주 바뀐다. 여기 적힌 기본값을
 *   믿지 말고 **현재 문서에서 확인해** 환경변수로 넣어야 한다. 코드에 박아 두면
 *   조용히 낡는다.
 * ========================================================================= */
import http from 'node:http';
import { Buffer } from 'node:buffer';

const PORT = Number(process.env.PORT || 8787);
const PROVIDER = process.env.VTON_PROVIDER || 'openai';
const API_KEY = process.env.VTON_API_KEY || '';
const MODEL = process.env.VTON_MODEL || '';
const ENDPOINT = process.env.VTON_ENDPOINT || '';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

const MAX_BODY = 24 * 1024 * 1024;   // 인물 1장 + 옷 몇 장이면 충분하다

/* ── 사용 한도 ───────────────────────────────────────────────────────────
 * 장당 과금이므로 상한이 없으면 비용이 무한이다. 한 사람이 하루에 몇 벌까지
 * 볼 수 있는지를 정한다.
 *
 * 누가 누구인지는 로그인 없이 알 수 없으므로 두 가지로 센다.
 *   · 클라이언트 ID — 브라우저가 만들어 보관하는 임의의 값. 지우면 초기화된다.
 *   · IP — 그것을 막는 뒷받침. 다만 **원본을 저장하지 않는다** (아래 참고).
 *
 * 둘 다 완벽하지 않지만 비용 폭주를 막는 데는 충분하다. 정확한 과금이
 * 필요해지면 그때 로그인을 붙이는 것이 순서다. */
const QUOTA_PER_DAY = Number(process.env.VTON_QUOTA_PER_DAY || 5);
const QUOTA_PER_IP_DAY = Number(process.env.VTON_QUOTA_PER_IP_DAY || 20);

/* IP 는 그 자체로 개인정보다. 남용을 막는 데는 "같은 곳인가"만 알면 되므로
 * 원본 대신 해시를 센다. 소금은 매일 바뀌므로 어제의 해시는 오늘 아무 의미가
 * 없다 — 기록이 쌓여 추적 수단이 되는 것을 구조적으로 막는다. */
import { createHash, randomBytes } from 'node:crypto';
let saltDay = '', salt = randomBytes(16);
function dayKey() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}
function anon(v) {
  const day = dayKey();
  if (day !== saltDay) { saltDay = day; salt = randomBytes(16); counters.clear(); }
  return createHash('sha256').update(salt).update(String(v || '')).digest('hex').slice(0, 24);
}
/** 하루치만 메모리에 둔다. 날이 바뀌면 통째로 비운다 — 보관하지 않는다. */
const counters = new Map();
function take(kind, key, limit) {
  const k = kind + ':' + key;
  const used = counters.get(k) || 0;
  if (used >= limit) return { ok: false, used, limit };
  counters.set(k, used + 1);
  return { ok: true, used: used + 1, limit };
}
function peek(kind, key, limit) {
  return { used: counters.get(kind + ':' + key) || 0, limit };
}
function clientIP(req) {
  const f = req.headers['x-forwarded-for'];
  if (f) return String(f).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

/* ── multipart/form-data 파싱 ────────────────────────────────────────────
 * 의존성을 넣지 않기 위해 직접 읽는다. 우리가 보내는 형태만 다루면 되므로
 * 완전한 구현일 필요가 없다 — 대신 그 사실을 여기 적어 둔다. */
function parseMultipart(buf, boundary) {
  const parts = [];
  const bb = Buffer.from('--' + boundary);
  let i = buf.indexOf(bb);
  while (i >= 0) {
    const start = i + bb.length;
    if (buf.slice(start, start + 2).toString() === '--') break;      // 마지막 경계
    const headEnd = buf.indexOf('\r\n\r\n', start);
    if (headEnd < 0) break;
    const head = buf.slice(start, headEnd).toString('utf8');
    let next = buf.indexOf(bb, headEnd);
    if (next < 0) next = buf.length;
    const body = buf.slice(headEnd + 4, next - 2);                   // 앞의 \r\n 제거
    const name = /name="([^"]*)"/.exec(head);
    const file = /filename="([^"]*)"/.exec(head);
    const type = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    parts.push({
      name: name ? name[1] : '', filename: file ? file[1] : null,
      contentType: type ? type[1].trim() : null, data: body
    });
    i = next;
  }
  return parts;
}

/* ── 공급자 어댑터 ───────────────────────────────────────────────────────
 * 각 어댑터는 (인물 PNG, 옷 PNG, 작업 정보) 를 받아 PNG 버퍼를 돌려준다.
 * 새 공급자를 붙일 때 이 인터페이스만 맞추면 나머지는 그대로 쓴다.
 * 공급자를 바꿔 끼울 수 있게 해 두는 것이 중요하다 — 이 분야는 6개월이면
 * 더 나은 것이 나온다. */
const providers = {
  /* 범용 이미지 편집 모델. 접근이 쉽지만 옷 충실도가 약하다 —
   * 고른 그 옷이 아니라 비슷한 다른 옷을 그려낼 수 있다. */
  async openai(person, garment, job, mask) {
    if (!MODEL) throw new Error('VTON_MODEL 을 설정해 주세요 (공급자 문서에서 확인).');
    const fd = new FormData();
    fd.append('model', MODEL);
    fd.append('image', new Blob([person], { type: 'image/png' }), 'person.png');
    if (garment) fd.append('image', new Blob([garment], { type: 'image/png' }), 'garment.png');
    fd.append('prompt',
      '첫 번째 이미지의 인물에게 두 번째 이미지의 옷을 입힌 사진. ' +
      '인물의 얼굴·머리·체형·자세·피부톤은 그대로 유지한다. ' +
      '옷의 색·무늬·재단은 두 번째 이미지 그대로 재현한다. ' +
      '배경은 투명하거나 흰색. 사진처럼 자연스러운 주름과 그림자.');
    fd.append('size', 'auto');
    const r = await fetch(ENDPOINT || 'https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + API_KEY },
      body: fd
    });
    if (!r.ok) throw new Error('provider ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const j = await r.json();
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) throw new Error('응답에 이미지가 없습니다.');
    return Buffer.from(b64, 'base64');
  },

  /* 전용 가상 피팅 모델을 호스팅해 주는 곳. 이 작업만 학습돼 있어
   * 옷 충실도와 인물 보존이 범용 모델보다 낫다. */
  async replicate(person, garment, job, mask) {
    if (!MODEL) throw new Error('VTON_MODEL(버전 해시)을 설정해 주세요.');
    const b64 = (b) => 'data:image/png;base64,' + b.toString('base64');
    const create = await fetch(ENDPOINT || 'https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: MODEL,
        input: {
          human_img: b64(person),
          garm_img: garment ? b64(garment) : undefined,
          category: job.category === 'bottom' ? 'lower_body' : 'upper_body',
          garment_des: job.ko || 'garment'
        }
      })
    });
    if (!create.ok) throw new Error('provider ' + create.status + ': ' + (await create.text()).slice(0, 300));
    let pred = await create.json();
    /* 예측형 API 는 즉시 끝나지 않는다. 완료까지 폴링한다 —
     * 클라이언트가 한 번만 기다리면 되도록 왕복을 여기서 흡수한다. */
    const started = Date.now();
    while (pred.status === 'starting' || pred.status === 'processing') {
      if (Date.now() - started > 80000) throw new Error('공급자 응답이 너무 느립니다.');
      await new Promise((r) => setTimeout(r, 1500));
      const p = await fetch(pred.urls.get, { headers: { Authorization: 'Bearer ' + API_KEY } });
      pred = await p.json();
    }
    if (pred.status !== 'succeeded') throw new Error('합성 실패: ' + (pred.error || pred.status));
    const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    const img = await fetch(outUrl);
    return Buffer.from(await img.arrayBuffer());
  },

  /* 직접 띄운 모델(IDM-VTON 등). 장당 과금이 없고 사진이 밖으로 나가지
   * 않는다는 점에서 이 앱의 약속에 가장 가깝다. */
  async custom(person, garment, job, mask) {
    if (!ENDPOINT) throw new Error('VTON_ENDPOINT 를 설정해 주세요.');
    const fd = new FormData();
    fd.append('person', new Blob([person], { type: 'image/png' }), 'person.png');
    if (garment) fd.append('garment', new Blob([garment], { type: 'image/png' }), 'garment.png');
    /* 옷이 놓일 자리 마스크를 브라우저가 함께 보낸다.
     * 이게 있으면 모델 서버는 사람 파싱·자세 추정(Detectron2/DensePose)을
     * 돌릴 필요가 없다 — 설치의 대부분이자 애플 실리콘에서 막히는 부분이다. */
    if (mask) fd.append('mask', new Blob([mask], { type: 'image/png' }), 'mask.png');
    fd.append('category', job.category || 'top');
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: API_KEY ? { Authorization: 'Bearer ' + API_KEY } : {},
      body: fd
    });
    if (!r.ok) throw new Error('provider ' + r.status + ': ' + (await r.text()).slice(0, 300));
    /* 모델 서버가 모의 모드면 그 사실을 그대로 실어 보낸다.
     * 인물 사진이 그대로 돌아오는데 화면이 "고화질"이라고 말하면,
     * 배선 문제를 합성 품질 문제로 착각하게 된다. */
    return { png: Buffer.from(await r.arrayBuffer()), mock: r.headers.get('x-vton-mock') === '1' };
  }
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  /* X-Client-Id 를 빼먹으면 브라우저가 프리플라이트에서 막는다. 커스텀
   * 헤더 하나가 요청을 preflight 대상으로 만든다는 것을 잊기 쉽다. */
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  if (req.url && req.url.split('?')[0] === '/health') {
    const cid = req.headers['x-client-id'] || '';
    const q = peek('cid', anon(cid), QUOTA_PER_DAY);
    return json(res, 200, {
      ok: true, provider: PROVIDER,
      keySet: !!API_KEY, modelSet: !!MODEL,
      quota: { perDay: QUOTA_PER_DAY, used: q.used, left: Math.max(0, QUOTA_PER_DAY - q.used) },
      // 키 자체는 절대 돌려주지 않는다. 설정됐는지만 알려준다.
      ko: API_KEY || PROVIDER === 'custom' ? '준비됨' : 'VTON_API_KEY 가 설정되지 않았습니다.'
    });
  }

  if (req.method !== 'POST' || req.url !== '/compose') {
    return json(res, 404, { ok: false, ko: '없는 경로입니다.' });
  }
  if (!API_KEY && PROVIDER !== 'custom') {
    return json(res, 500, { ok: false, ko: 'VTON_API_KEY 가 설정되지 않았습니다.' });
  }

  /* 한도는 **공급자를 부르기 전에** 본다. 부르고 나서 막으면 돈은 이미 나갔다. */
  const cidHash = anon(req.headers['x-client-id'] || '');
  const ipHash = anon(clientIP(req));
  const qIp = take('ip', ipHash, QUOTA_PER_IP_DAY);
  if (!qIp.ok) {
    return json(res, 429, { ok: false, quotaExceeded: true,
      ko: '이 네트워크에서 오늘 사용할 수 있는 횟수를 모두 썼습니다. 내일 다시 시도해 주세요.' });
  }
  const q = take('cid', cidHash, QUOTA_PER_DAY);
  if (!q.ok) {
    return json(res, 429, { ok: false, quotaExceeded: true,
      quota: { perDay: QUOTA_PER_DAY, used: q.used, left: 0 },
      ko: '오늘 사용할 수 있는 ' + QUOTA_PER_DAY + '벌을 모두 썼습니다. 내일 다시 시도해 주세요. ' +
          '내장 엔진 합성은 횟수 제한 없이 계속 쓰실 수 있습니다.' });
  }

  const ct = req.headers['content-type'] || '';
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
  if (!m) return json(res, 400, { ok: false, ko: 'multipart 요청이 아닙니다.' });
  const boundary = (m[1] || m[2]).trim();

  const chunks = [];
  let size = 0;
  try {
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) { return json(res, 413, { ok: false, ko: '요청이 너무 큽니다.' }); }
      chunks.push(c);
    }
  } catch {
    return json(res, 400, { ok: false, ko: '요청을 읽지 못했습니다.' });
  }

  const parts = parseMultipart(Buffer.concat(chunks), boundary);
  const person = parts.find((p) => p.name === 'person');
  const maskPart = parts.find((p) => p.name === 'mask');
  const jobsPart = parts.find((p) => p.name === 'jobs');
  if (!person) return json(res, 400, { ok: false, ko: '인물 이미지가 없습니다.' });

  let jobs = [];
  try { jobs = JSON.parse(jobsPart ? jobsPart.data.toString('utf8') : '[]'); } catch { }
  if (!jobs.length) return json(res, 400, { ok: false, ko: '입힐 옷이 없습니다.' });

  const impl = providers[PROVIDER];
  if (!impl) return json(res, 500, { ok: false, ko: '알 수 없는 공급자: ' + PROVIDER });

  /* 여러 겹은 **한 벌씩 순서대로** 입힌다.
   * 확산 모델은 옷 한 벌을 입히는 것으로 학습돼 있어서 여러 벌을 한 번에
   * 주면 섞어 그린다. 이전 결과를 다음 호출의 인물로 넘긴다.
   * 왕복을 서버 안에서 처리하는 이유는, 클라이언트가 매번 큰 이미지를
   * 다시 올리면 지연이 배로 늘기 때문이다. */
  let current = person.data;
  let mock = false;
  const t0 = Date.now();
  try {
    for (const job of jobs) {
      const g = parts.find((p) => p.name === 'garment' + job.index);
      /* 마스크는 **첫 겹에만** 쓴다. 두 번째 겹부터는 인물이 이미 첫 옷을
       * 입고 있으므로 처음의 마스크가 맞지 않는다 — 그 자리는 모델이
       * 스스로 판단하게 두는 편이 낫다. */
      const m = (job.index === jobs[0].index && maskPart) ? maskPart.data : null;
      /* 공급자는 Buffer 또는 { png, mock } 을 돌려준다 */
      const out = await impl(current, g ? g.data : null, job, m);
      if (out && out.png) { current = out.png; if (out.mock) mock = true; }
      else current = out;
    }
  } catch (e) {
    /* 실패한 호출로 사용자의 횟수를 깎지 않는다. 우리 쪽 사정으로 실패했는데
     * 남은 횟수가 줄어드는 것은 사용자에게 설명할 수 없다. */
    counters.set('cid:' + cidHash, Math.max(0, (counters.get('cid:' + cidHash) || 1) - 1));
    counters.set('ip:' + ipHash, Math.max(0, (counters.get('ip:' + ipHash) || 1) - 1));
    return json(res, 502, { ok: false, ko: String(e.message || e) });
  }

  return json(res, 200, {
    ok: true, provider: PROVIDER, mock: mock, ms: Date.now() - t0,
    quota: { perDay: QUOTA_PER_DAY, used: q.used, left: Math.max(0, QUOTA_PER_DAY - q.used) },
    image: 'data:image/png;base64,' + current.toString('base64')
  });
});

/* 어디에 붙일 것인가 — 겉보기보다 중요하다.
 *
 * 주소를 지정하지 않으면 Node 는 IPv4 의 0.0.0.0 에만 붙는다. 그런데
 * **맥에서 localhost 는 IPv6(::1) 로 먼저 풀린다.** 그러면 브라우저가 연결할
 * 곳이 없어 "연결하지 못했습니다"만 나오고 서버에는 아무 기록도 남지 않는다 —
 * 원인을 짐작할 단서가 없는 가장 나쁜 형태의 실패다.
 *
 * '::' 는 듀얼스택이라 IPv4·IPv6 양쪽을 받지만, IPv6 가 아예 없는 환경에서는
 * EAFNOSUPPORT 로 **서버가 뜨지 않는다.** 그건 더 나쁘다.
 * 그래서 먼저 시도하고, 안 되면 IPv4 로 물러난다. */
/* listen 에 콜백을 넘기면 'listening' 리스너로 등록된다. IPv6 시도가 실패한
 * 뒤 IPv4 로 다시 붙으면 그 콜백이 **아직 살아 있어** 배너가 두 번 찍힌다.
 * 디버깅할 때 정확히 헷갈리는 종류라, 리스너를 한 곳에만 둔다. */
server.on('listening', () => {
  const a = server.address();
  console.log(`vton-proxy  http://localhost:${PORT}  provider=${PROVIDER}` +
    `  한도 ${QUOTA_PER_DAY}벌/일 (IP ${QUOTA_PER_IP_DAY})` +
    `  bind=${a && a.address}` +
    (API_KEY || PROVIDER === 'custom' ? '' : '  ⚠ VTON_API_KEY 미설정'));
});
server.on('error', (e) => {
  if (e && e.code === 'EAFNOSUPPORT') {
    console.log('  IPv6 를 쓸 수 없어 IPv4 로 붙습니다.');
    server.listen(PORT, '0.0.0.0');
    return;
  }
  if (e && e.code === 'EADDRINUSE') {
    console.error(`⚠ 포트 ${PORT} 이 이미 사용 중입니다. 이전에 켠 서버가 남아 있는지 확인해 주세요.`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, '::');
