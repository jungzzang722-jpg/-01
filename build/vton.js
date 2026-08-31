/* =========================================================================
 * vton.js — 고화질 합성 (외부 API)
 *
 * 이 파일은 **고화질판에만** 들어간다. 원본(퍼스널컬러진단.html)에는 네트워크
 * 코드가 한 줄도 없다. 사이드바의 방패와 "이 브라우저 밖으로 나가지
 * 않습니다"가 그 파일에서는 무조건 참이어야 하기 때문이다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────
 * 내장 엔진은 평면 옷본을 실루엣에 휘어 붙인다. 천이 몸에 감기는 느낌,
 * 주름이 지는 방향, 팔이 옷을 가리는 관계 — 이런 것들은 그 방식에 없다.
 * 확산 모델 기반 가상 피팅은 그것을 학습으로 안다. 격차는 조정으로 좁혀지지
 * 않는다.
 *
 * ── 그런데 사진이 밖으로 나간다 ────────────────────────────────────────
 * 이 앱의 약속이 깨지는 지점이라, 다음을 규칙으로 못 박는다.
 *
 *  1. 진단용 얼굴 사진은 **절대** 보내지 않는다. 보내는 것은 3단계에서 올린
 *     전신 사진뿐이고, 그것도 **배경을 이미 지운 인물**만 보낸다.
 *  2. 색 진단은 생성된 이미지를 절대 쓰지 않는다. 모델은 사람을 다시 그리므로
 *     피부색이 바뀐다. 진단은 원본 사진에서 잰 값만 쓴다 — 그러지 않으면
 *     "당신은 겨울 딥"이라고 말한 얼굴과 화면 속 얼굴의 색이 달라져
 *     서비스가 스스로 모순된다.
 *  3. 매번 명시적으로 동의를 받는다. 한 번 켜면 조용히 계속 보내는 방식은
 *     쓰지 않는다.
 *  4. 실패하면 내장 엔진 결과로 되돌아가고, 왜 실패했는지 말한다.
 *
 * ── API 키는 여기 둘 수 없다 ───────────────────────────────────────────
 * 이 앱은 더블클릭으로 열리는 HTML 한 개다. 클라이언트에 키를 넣으면
 * 파일을 받은 사람 누구나 키를 꺼내 쓸 수 있다. 그래서 **작은 중계 서버**가
 * 반드시 필요하다(server/vton-proxy.mjs). 키는 거기 있고, 이 파일은 그
 * 주소만 안다. 주소를 넣지 않으면 이 기능은 통째로 꺼진 상태가 된다 —
 * 그때 이 파일은 원본과 똑같이 동작한다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var LS_KEY = 'pc.vton.endpoint';
  var LS_OK = 'pc.vton.consent';
  var LS_CID = 'pc.vton.cid';
  var TIMEOUT_MS = 90000;      // 확산 모델은 느리다. 10초로 끊으면 늘 실패한다.

  var _cache = null;           // IndexedDB 핸들
  var _mem = {};               // 세션 안에서는 메모리로 충분하다

  /* ---------------------------------------------------------------
   * 설정
   * ------------------------------------------------------------- */
  function endpoint() {
    try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; }
  }
  function setEndpoint(url) {
    try {
      if (url) localStorage.setItem(LS_KEY, url);
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* 사생활 모드 — 이번 세션만 동작한다 */ }
  }
  function enabled() { return !!endpoint(); }

  /**
   * 이 브라우저를 가리키는 임의의 값.
   *
   * 로그인이 없으므로 "하루 몇 벌" 을 세려면 무언가로 구분해야 한다.
   * 계정도 아니고 기기 지문도 아닌, 그냥 이 브라우저가 스스로 만든 난수다.
   * 지우면 초기화된다 — 완벽한 통제 수단이 아니라 **비용 폭주를 막는 울타리**다.
   * 정확한 과금이 필요해지면 그때 로그인을 붙이는 것이 순서다.
   */
  function clientId() {
    try {
      var v = localStorage.getItem(LS_CID);
      if (!v) {
        v = (global.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
        localStorage.setItem(LS_CID, v);
      }
      return v;
    } catch (e) {
      return 'anon';   // 사생활 모드 — 서버는 IP 한도로 막는다
    }
  }

  function consented() {
    try { return localStorage.getItem(LS_OK) === '1'; } catch (e) { return false; }
  }
  function setConsent(v) {
    try {
      if (v) localStorage.setItem(LS_OK, '1');
      else localStorage.removeItem(LS_OK);
    } catch (e) { /* 무시 */ }
  }

  /* ---------------------------------------------------------------
   * 보내기 전에 다듬는다 — 적게 보낼수록 좋다
   * ------------------------------------------------------------- */

  /**
   * 배경을 지운 인물만 남긴다.
   *
   * 원본 사진을 그대로 보내면 방·가구·같이 있는 사람까지 나간다. 합성에
   * 필요한 것은 인물뿐이므로 그것만 잘라 보낸다. 분리는 이미 온디바이스에서
   * 끝나 있다(SEGMENT.person) — 그 결과를 재사용한다.
   *
   * 얼굴은 지우지 않는다. 얼굴을 지우면 모델이 사람을 그리지 못한다.
   * 대신 "얼굴이 나간다"는 사실을 동의 문구에 그대로 적는다.
   */
  function personPayload(body, maxSide) {
    var w = body.w, h = body.h;
    var out = document.createElement('canvas');
    var sc = Math.min(1, (maxSide || 1024) / Math.max(w, h));
    out.width = Math.max(1, Math.round(w * sc));
    out.height = Math.max(1, Math.round(h * sc));
    var oc = out.getContext('2d');

    var tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    var tc = tmp.getContext('2d', { willReadFrequently: true });
    tc.drawImage(body.canvas, 0, 0);
    var im = tc.getImageData(0, 0, w, h), d = im.data;
    for (var p = 0; p < w * h; p++) {
      // edge 는 반화소 가장자리라 그대로 알파로 쓴다 — 톱니 없이 잘린다
      var a = body.mask[p] ? (body.edge ? body.edge[p] : 1) : 0;
      d[p * 4 + 3] = Math.round(255 * a);
    }
    tc.putImageData(im, 0, 0);
    oc.drawImage(tmp, 0, 0, out.width, out.height);
    return out;
  }

  /** 옷 이미지 — 반입한 사진이면 그 사진, 절차적 옷본이면 렌더 결과 */
  function garmentPayload(garmentId, maxSide) {
    var G = global.GARMENTS && GARMENTS.get(garmentId);
    if (!G || !G.canvas) return null;
    var s = Math.min(1, (maxSide || 768) / Math.max(G.canvas.width, G.canvas.height));
    if (s >= 1) return G.canvas;
    var cv = document.createElement('canvas');
    cv.width = Math.round(G.canvas.width * s);
    cv.height = Math.round(G.canvas.height * s);
    cv.getContext('2d').drawImage(G.canvas, 0, 0, cv.width, cv.height);
    return cv;
  }

  /* ---------------------------------------------------------------
   * 캐시 — 같은 조합을 두 번 보내지 않는다
   *
   * 장당 과금이고 10~30초가 걸리므로, 슬라이더를 만지거나 탭을 오갈 때마다
   * 다시 부르면 비용도 체감 속도도 무너진다. 사람과 옷이 같으면 결과도 같다.
   * ------------------------------------------------------------- */
  function hashCanvas(cv) {
    // 내용 해시 — 축소해서 훑는다. 충돌해도 같은 그림이면 문제가 없다.
    var s = 64, t = document.createElement('canvas');
    t.width = s; t.height = s;
    t.getContext('2d').drawImage(cv, 0, 0, s, s);
    var d = t.getContext('2d').getImageData(0, 0, s, s).data;
    var h1 = 0x811c9dc5;
    for (var i = 0; i < d.length; i += 4) {
      h1 ^= d[i] + (d[i + 1] << 3) + (d[i + 2] << 6) + (d[i + 3] << 9);
      h1 = (h1 * 0x01000193) >>> 0;
    }
    return h1.toString(36) + '-' + cv.width + 'x' + cv.height;
  }

  function cacheKey(personCv, layers) {
    return hashCanvas(personCv) + '|' +
      layers.map(function (l) { return l.garmentId + ':' + (l.colorHex || ''); }).join(',');
  }

  function openCache() {
    if (_cache) return _cache;
    _cache = new Promise(function (res) {
      if (!global.indexedDB) return res(null);
      var rq = indexedDB.open('pc-vton', 1);
      rq.onupgradeneeded = function () {
        if (!rq.result.objectStoreNames.contains('img')) rq.result.createObjectStore('img');
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { res(null); };
    });
    return _cache;
  }

  function cacheGet(key) {
    if (_mem[key]) return Promise.resolve(_mem[key]);
    return openCache().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        var rq = db.transaction('img', 'readonly').objectStore('img').get(key);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      });
    });
  }

  function cachePut(key, dataUrl) {
    _mem[key] = dataUrl;
    return openCache().then(function (db) {
      if (!db) return;
      try { db.transaction('img', 'readwrite').objectStore('img').put(dataUrl, key); }
      catch (e) { /* 용량 초과 — 메모리 캐시만으로 간다 */ }
    });
  }

  function clearCache() {
    _mem = {};
    return openCache().then(function (db) {
      if (!db) return;
      try { db.transaction('img', 'readwrite').objectStore('img').clear(); } catch (e) { }
    });
  }

  /* ---------------------------------------------------------------
   * 호출
   * ------------------------------------------------------------- */
  function toBlob(cv) {
    return new Promise(function (res) { cv.toBlob(res, 'image/png'); });
  }

  /**
   * @param body    TRYON.prepare 결과 (분리·마스크가 들어 있다)
   * @param layers  [{ garmentId, colorHex }] — 아래에서 위 순서
   * @param opts    { signal, onStage }
   * @returns { ok, dataUrl, cached, ms, provider } 또는 { ok:false, ko }
   */
  function compose(body, layers, opts) {
    opts = opts || {};
    var url = endpoint();
    if (!url) {
      return Promise.resolve({ ok: false, off: true,
        ko: '고화질 합성 서버 주소가 설정되지 않았습니다.' });
    }
    if (!consented()) {
      return Promise.resolve({ ok: false, needConsent: true,
        ko: '사진을 외부로 보내는 것에 대한 동의가 필요합니다.' });
    }
    var tops = (layers || []).filter(function (l) { return l.garmentId; });
    if (!tops.length) {
      return Promise.resolve({ ok: false, ko: '입힐 옷이 없습니다.' });
    }

    var stage = opts.onStage || function () { };
    var t0 = (global.performance || Date).now();
    var personCv = personPayload(body, opts.maxSide || 1024);
    var key = cacheKey(personCv, tops);

    return cacheGet(key).then(function (hit) {
      if (hit) {
        return { ok: true, dataUrl: hit, cached: true, ms: 0 };
      }
      stage('보내는 중');
      var fd = new FormData();
      return toBlob(personCv).then(function (pb) {
        fd.append('person', pb, 'person.png');
        /* 여러 겹은 한 번에 보내지 않는다. 확산 모델은 옷 한 벌을 입히는
         * 것으로 학습돼 있어서, 여러 벌을 한 번에 주면 섞어 그린다.
         * 아래층부터 한 벌씩 순서대로 입히는 것은 서버가 맡는다 —
         * 왕복이 늘어나면 지연이 배로 늘기 때문이다. */
        var jobs = [];
        var chain = Promise.resolve();
        tops.forEach(function (l, i) {
          chain = chain.then(function () {
            var gc = garmentPayload(l.garmentId, opts.garmentMaxSide || 768);
            if (!gc) return;
            return toBlob(gc).then(function (gb) {
              fd.append('garment' + i, gb, 'garment' + i + '.png');
              var spec = global.GARMENTS && GARMENTS.byId(l.garmentId);
              jobs.push({
                index: i,
                category: spec ? spec.cat : 'top',
                ko: spec ? spec.ko : '',
                colorHex: l.colorHex || null
              });
            });
          });
        });
        return chain.then(function () {
          fd.append('jobs', JSON.stringify(jobs));
          return post(url, fd, stage, opts.signal);
        });
      }).then(function (r) {
        if (!r.ok) return r;
        return cachePut(key, r.dataUrl).then(function () {
          r.ms = Math.round((global.performance || Date).now() - t0);
          return r;
        });
      });
    });
  }

  function post(url, fd, stage, signal) {
    var ctrl = global.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    if (signal && ctrl) {
      signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    stage('합성 중');
    return fetch(url.replace(/\/+$/, '') + '/compose', {
      method: 'POST', body: fd,
      headers: { 'X-Client-Id': clientId() },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (t) {
          /* 한도 초과는 서버가 남은 횟수까지 알고 있다. 그 말을 그대로 쓴다 —
           * 여기서 다시 지어내면 서버가 아는 것보다 부정확해진다. */
          var j = null;
          try { j = JSON.parse(t); } catch (e) { }
          if (j && j.quotaExceeded) {
            return { ok: false, status: res.status, quotaExceeded: true,
                     quota: j.quota || null, ko: j.ko };
          }
          return { ok: false, status: res.status, ko: readableError(res.status, t) };
        });
      }
      return res.json();
    }).then(function (j) {
      if (!j || j.ok === false) return j || { ok: false, ko: '서버가 응답을 주지 않았습니다.' };
      if (j.ok && j.image) {
        return { ok: true, dataUrl: j.image, provider: j.provider || null, quota: j.quota || null };
      }
      return j;
    }).catch(function (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        return { ok: false, ko: '시간이 너무 오래 걸려 중단했습니다. 잠시 후 다시 시도해 주세요.' };
      }
      return { ok: false, ko: '고화질 합성 서버에 연결하지 못했습니다. 주소를 확인해 주세요.' };
    });
  }

  /* 오류를 사용자의 말로 옮긴다. 상태 코드만 보여주면 아무도 못 고친다. */
  function readableError(status, body) {
    if (status === 401 || status === 403) {
      return '서버가 API 키를 거부했습니다. 중계 서버의 키 설정을 확인해 주세요.';
    }
    if (status === 429) {
      return '요청이 한도를 넘었습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (status === 413) {
      return '이미지가 너무 큽니다. 더 작은 사진으로 시도해 주세요.';
    }
    if (status >= 500) {
      return '합성 서버에 문제가 있습니다(' + status + '). 잠시 후 다시 시도해 주세요.';
    }
    var t = (body || '').slice(0, 160);
    return '합성에 실패했습니다(' + status + ')' + (t ? ' — ' + t : '');
  }

  /* ---------------------------------------------------------------
   * 서버 상태 확인 — 주소를 넣자마자 되는지 알려준다
   * ------------------------------------------------------------- */
  function ping(url) {
    var u = (url || endpoint()).replace(/\/+$/, '');
    if (!u) return Promise.resolve({ ok: false, ko: '주소가 비어 있습니다.' });
    var ctrl = global.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    return fetch(u + '/health', {
      headers: { 'X-Client-Id': clientId() },
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (r) { clearTimeout(timer); return r.ok ? r.json() : { ok: false, ko: 'HTTP ' + r.status }; })
      .catch(function () { clearTimeout(timer); return { ok: false, ko: '연결하지 못했습니다.' }; });
  }

  global.VTON = {
    enabled: enabled, endpoint: endpoint, setEndpoint: setEndpoint,
    consented: consented, setConsent: setConsent,
    compose: compose, ping: ping, clientId: clientId,
    personPayload: personPayload, garmentPayload: garmentPayload,
    cacheKey: cacheKey, clearCache: clearCache,
    TIMEOUT_MS: TIMEOUT_MS
  };
})(window);

/* =========================================================================
 * vton-ui.js — 고화질 합성 화면
 *
 * fitroom.js 를 건드리지 않고 **스스로 끼어든다.** fitroom 은 두 파일이
 * 공유하므로, 거기에 고화질 관련 코드를 넣으면 원본에도 따라 들어간다.
 * 이 모듈은 고화질판에만 있으므로 여기서 붙이는 것이 맞다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var CSS = [
    '.vt-card{margin-top:14px;padding:13px 15px;border-radius:var(--r-box);',
    '  background:var(--fill-4);box-shadow:0 0 0 .5px var(--separator),inset 3px 0 0 var(--purple,#5856D6)}',
    '.vt-card>b{display:block;font-size:13.5px;font-weight:600}',
    '.vt-card p{font-size:12.5px;color:var(--label-2);margin:7px 0 0;line-height:1.6}',
    '.vt-card .hint{font-size:11.5px;color:var(--label-3);margin-top:6px}',
    '.vt-row{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}',
    '.vt-row input[type=url]{flex:1 1 220px;min-width:0;padding:7px 10px;font-size:12.5px;',
    '  border-radius:8px;border:0;box-shadow:0 0 0 .5px var(--separator);background:var(--bg)}',
    '.vt-state{font-size:12px;color:var(--label-2)}',
    '.vt-state.bad{color:var(--red)} .vt-state.good{color:var(--green)}',
    '.vt-out{margin-top:11px;display:none}',
    '.vt-out img{width:100%;border-radius:var(--r-box);display:block;background:var(--fill-3)}',
    '.vt-cmp{display:flex;gap:8px;margin-top:8px}',
    '.vt-cmp figure{flex:1;margin:0}',
    '.vt-cmp figcaption{font-size:11px;color:var(--label-3);margin-top:4px;text-align:center}',
    '.vt-cmp canvas,.vt-cmp img{width:100%;border-radius:10px;display:block;background:var(--fill-3)}'
  ].join('\n');

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html != null) n.innerHTML = html;
    return n;
  }

  function cardHTML() {
    return '' +
      '<b>고화질 합성 <span style="font-weight:400;color:var(--label-3)">(외부 서버)</span></b>' +
      '<p>내장 엔진은 평면 옷본을 실루엣에 맞춰 휘어 붙입니다. 천이 몸에 감기는 느낌과 ' +
      '주름은 그 방식에 없습니다. 확산 모델은 그것을 학습으로 알고 있어 훨씬 자연스럽습니다.</p>' +
      '<p><b>대신 사진이 이 브라우저 밖으로 나갑니다.</b> 나가는 것은 ' +
      '<b>배경을 지운 전신 인물 사진</b>과 옷 이미지이며, <b>얼굴이 포함됩니다.</b> ' +
      '1단계의 얼굴 진단 사진은 보내지 않습니다. 색 진단 결과는 원본 사진에서 잰 값만 쓰므로 ' +
      '여기서 만들어진 이미지에 영향을 받지 않습니다.</p>' +
      '<div class="vt-row">' +
      '  <input type="url" id="vtUrl" placeholder="중계 서버 주소 (예: http://localhost:8787)">' +
      '  <button class="btn secondary" id="vtSave" style="padding:7px 13px;font-size:12.5px">확인</button>' +
      '  <span class="vt-state" id="vtState"></span>' +
      '</div>' +
      '<div class="vt-row">' +
      '  <label style="font-size:12.5px;display:flex;gap:7px;align-items:center">' +
      '    <input type="checkbox" id="vtOk"> 위 내용을 이해했고 사진 전송에 동의합니다</label>' +
      '</div>' +
      '<div class="vt-row">' +
      '  <button class="btn" id="vtRun" disabled>고화질로 합성</button>' +
      '  <button class="btn secondary" id="vtClear" style="font-size:12.5px">캐시 비우기</button>' +
      '  <span class="vt-state" id="vtRunState"></span>' +
      '</div>' +
      '<div class="vt-out" id="vtOut"><div class="vt-cmp">' +
      '  <figure><img id="vtLocal" alt="내장 엔진 결과"><figcaption>내장 엔진 · 즉시 · 사진이 나가지 않음</figcaption></figure>' +
      '  <figure><img id="vtRemote" alt="고화질 합성 결과"><figcaption id="vtRemoteCap">고화질</figcaption></figure>' +
      '</div></div>' +
      '<p class="hint">API 키는 이 파일이 아니라 중계 서버에 있습니다. 단일 HTML 에 키를 넣으면 ' +
      '파일을 받은 사람 누구나 꺼내 쓸 수 있기 때문입니다. 주소를 비워 두면 이 기능은 꺼지고 ' +
      '앱은 원본과 똑같이 동작합니다.</p>';
  }

  function attach(panel) {
    if (panel.querySelector('.vt-card')) return;
    if (!document.getElementById('vt-css')) {
      var st = el('style', { id: 'vt-css' }, CSS);
      document.head.appendChild(st);
    }
    var card = el('div', { class: 'vt-card' }, cardHTML());
    panel.appendChild(card);

    var $ = function (id) { return card.querySelector('#' + id); };
    var url = $('vtUrl'), save = $('vtSave'), state = $('vtState');
    var ok = $('vtOk'), run = $('vtRun'), out = $('vtOut'), runState = $('vtRunState');

    url.value = VTON.endpoint();
    ok.checked = VTON.consented();

    function refresh() {
      run.disabled = !(VTON.enabled() && ok.checked);
    }
    refresh();

    function setState(node, msg, cls) {
      node.textContent = msg || '';
      node.className = 'vt-state' + (cls ? ' ' + cls : '');
    }

    function quotaText(q) {
      if (!q) return '';
      return ' · 오늘 남은 횟수 ' + q.left + '/' + q.perDay;
    }
    function showHealth(h) {
      setState(state,
        h.ok ? '서버 연결됨 · ' + (h.ko || '') + quotaText(h.quota) : (h.ko || '연결 실패'),
        h.ok ? 'good' : 'bad');
      if (h.ok && h.quota && h.quota.left <= 0) {
        run.disabled = true;
        setState(runState, '오늘 횟수를 모두 썼습니다. 내장 엔진 합성은 계속 쓰실 수 있습니다.');
      }
    }
    if (VTON.enabled()) VTON.ping().then(showHealth);

    save.onclick = function () {
      var v = url.value.trim();
      VTON.setEndpoint(v);
      refresh();
      if (!v) return setState(state, '꺼짐');
      setState(state, '확인 중…');
      VTON.ping(v).then(showHealth);
    };
    ok.onchange = function () { VTON.setConsent(ok.checked); refresh(); };
    $('vtClear').onclick = function () {
      VTON.clearCache().then(function () { setState(runState, '캐시를 비웠습니다'); });
    };

    run.onclick = function () {
      var snap = global.FITROOM && FITROOM.snapshot();
      if (!snap || !snap.body) return setState(runState, '먼저 옷을 입혀 주세요', 'bad');
      if (!snap.layers || !snap.layers.length) return setState(runState, '입힐 옷이 없습니다', 'bad');

      run.disabled = true;
      setState(runState, '준비 중…');
      // 비교를 위해 지금 화면(내장 엔진 결과)을 옆에 붙여 둔다
      if (snap.canvas) {
        try { $('vtLocal').src = snap.canvas.toDataURL('image/png'); } catch (e) { }
      }
      out.style.display = 'block';

      VTON.compose(snap.body, snap.layers, {
        onStage: function (s) { setState(runState, s + '…'); }
      }).then(function (r) {
        run.disabled = false;
        refresh();
        if (!r.ok) {
          setState(runState, r.ko || '실패했습니다', 'bad');
          if (r.quotaExceeded) { run.disabled = true; setState(state, '오늘 한도 소진', 'bad'); }
          $('vtRemote').removeAttribute('src');
          $('vtRemoteCap').textContent = '고화질 — 실패, 왼쪽 결과를 그대로 씁니다';
          return;
        }
        $('vtRemote').src = r.dataUrl;
        $('vtRemoteCap').textContent = r.cached
          ? '고화질 · 이전 결과 재사용(전송하지 않음)'
          : '고화질 · ' + (r.ms != null ? (r.ms / 1000).toFixed(1) + '초' : '') +
            (r.provider ? ' · ' + r.provider : '');
        setState(runState, '완료' + quotaText(r.quota), 'good');
        if (r.quota && r.quota.left <= 0) run.disabled = true;
      });
    };
  }

  /* 피팅 탭은 사용자가 그 탭을 열 때 만들어진다. 언제 생기는지 알 수 없으므로
   * 나타나는 것을 지켜본다 — fitroom 에 훅을 넣으면 원본까지 바뀐다. */
  function watch() {
    var seen = new WeakSet();
    function scan() {
      var ps = document.querySelectorAll('.tab-panel[data-panel="tryon"][data-mounted="1"]');
      for (var i = 0; i < ps.length; i++) {
        if (seen.has(ps[i])) continue;
        seen.add(ps[i]);
        try { attach(ps[i]); } catch (e) { /* 화면 한 조각 때문에 앱이 죽으면 안 된다 */ }
      }
    }
    new MutationObserver(scan).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-mounted']
    });
    scan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }

  global.VTON_UI = { attach: attach };
})(window);
