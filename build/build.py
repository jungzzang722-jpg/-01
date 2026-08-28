#!/usr/bin/env python3
"""
build/build.py — 가상 피팅 모듈을 단일 파일 배포본에 합친다.

이 저장소의 배포 형태는 "더블클릭으로 열리는 HTML 한 개"다. 그 약속을 지키려면
새 기능도 별도 파일이 아니라 같은 파일 안으로 들어가야 한다. 그렇다고 440KB짜리
HTML을 직접 편집하면 모듈 경계가 사라지므로, 모듈은 따로 두고 여기서 합친다.

  build/base.html   손대지 않은 원본 (가상 피팅 이전 상태)
  build/*.js/.css   새 모듈
  →  퍼스널컬러진단.html

원본을 그대로 두는 이유: 어떤 변경이 이 기능 때문에 생긴 것인지
`diff build/base.html 퍼스널컬러진단.html` 한 줄로 확인할 수 있다.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
B = ROOT / 'build'
s = (B / 'base.html').read_text(encoding='utf-8')

def must(old, new, label, n=1):
    global s
    c = s.count(old)
    if c != n:
        sys.exit(f"build failed [{label}]: anchor found {c} times, expected {n}")
    s = s.replace(old, new, n)

# ── 1. 스타일 ────────────────────────────────────────────────────────────
must("\n</style>", (B / 'fitroom.css').read_text(encoding='utf-8') + "\n</style>", 'css')

# ── 2. 엔진 3종 : recommend.js 앞 (CC·DETECT·BODY 뒤여야 한다) ───────────
engines = "".join(
    "<script>\n" + (B / f).read_text(encoding='utf-8').rstrip() + "\n</script>\n"
    for f in ('garments.js', 'recolor.js', 'tryon.js', 'multiview.js')
)
A_REC = "<script>\n/* =========================================================================\n * recommend.js"
must(A_REC, engines + A_REC, 'engines')

# ── 3. 화면 모듈 : app.js 앞 (REPORT·RECOMMEND 뒤여야 한다) ──────────────
A_APP = "<script>\n/* =========================================================================\n * app.js"
must(A_APP, "<script>\n" + (B / 'fitroom.js').read_text(encoding='utf-8').rstrip() + "\n</script>\n" + A_APP, 'fitroom')

# ── 4. 리포트 탭 등록 ───────────────────────────────────────────────────
must("""      outfit: { key: 'outfit', ko: '코디' },
      color: { key: 'color', ko: '색 배치' },""",
"""      outfit: { key: 'outfit', ko: '코디' },
      // 가상 피팅은 코디 바로 다음이다. 색과 아이템을 읽은 직후에
      // "그래서 내가 입으면 어떻게 보이는가"가 오는 것이 자연스러운 순서다.
      tryon: { key: 'tryon', ko: '가상 피팅' },
      color: { key: 'color', ko: '색 배치' },""", 'tab-def')

must("""    if (goal === 'color') return [T.color, T.beauty, T.outfit, T.hair, T.save];
    if (goal === 'hair') return [T.hair, T.color, T.beauty, T.outfit, T.save];
    return [T.outfit, T.color, T.hair, T.beauty, T.save];""",
"""    if (goal === 'color') return [T.color, T.tryon, T.beauty, T.outfit, T.hair, T.save];
    if (goal === 'hair') return [T.hair, T.color, T.beauty, T.outfit, T.tryon, T.save];
    return [T.outfit, T.tryon, T.color, T.hair, T.beauty, T.save];""", 'tab-order')

must("""    h += '<div class="tab-panel hidden" data-panel="color"><div class="card">' +""",
"""    /* ---------- 가상 피팅 탭 ---------- */
    // 내용은 FITROOM이 마운트 시점에 채운다. 리포트 HTML을 만들 때 이미 그리면
    // 숨어 있는 캔버스에 그리게 되고, 무엇보다 합성이 수백 ms 걸려 리포트 전체가 늦어진다.
    h += '<div class="tab-panel hidden" data-panel="tryon"></div>';

    h += '<div class="tab-panel hidden" data-panel="color"><div class="card">' +""", 'panel')

must("""  function mountFullReport(root, dx, body, rec, feat, goal) {
    goal = goal || 'all';""",
"""  function mountFullReport(root, dx, body, rec, feat, goal, fullImage, fullState) {
    goal = goal || 'all';""", 'mount-sig')

must("""    V().mountTabs(root, 'rtabs', function () {
      // 탭이 열릴 때 캔버스를 그린다 (숨어있을 때 그리면 크기가 0이 될 수 있다)
      drawFigures(root, dx, body, rec, feat);
      drawHairPreviews(root, feat, rec);
      drawShare(root, dx);
    });""",
"""    V().mountTabs(root, 'rtabs', function (panel) {
      // 탭이 열릴 때 캔버스를 그린다 (숨어있을 때 그리면 크기가 0이 될 수 있다)
      drawFigures(root, dx, body, rec, feat);
      drawHairPreviews(root, feat, rec);
      drawShare(root, dx);
      // 가상 피팅은 준비 비용이 크므로 그 탭을 실제로 열었을 때만 시작한다
      if (panel === 'tryon' && global.FITROOM) {
        FITROOM.mount(root, {
          dx: dx, rec: rec, feat: feat,
          body: body, hasBody: !!(body && body.ok),
          sourceImage: fullImage || null,
          full: fullState || null
        });
      }
    });""", 'mount-tabs')

# ── 5. 앱 : 원본 전신 이미지를 들고 있다가 넘긴다 ────────────────────────
must("      state.full = { work: body.work, body: body, lines: cloneLines(body.landmarks) };",
"""      // 원본 이미지를 함께 들고 있는다. 체형 분석은 640px면 충분하지만
      // 가상 피팅은 눈으로 보는 결과물이라 그 해상도로는 거칠다.
      state.full = { work: body.work, body: body, img: img, lines: cloneLines(body.landmarks) };""",
     'state-full')

must("        REPORT.mountFullReport(el, b.dx, bodyOk, state.rec, b.feat, state.opts.goal);",
"""        REPORT.mountFullReport(el, b.dx, bodyOk, state.rec, b.feat, state.opts.goal,
          state.full ? state.full.img : null);""", 'mount-call')

# ── 6. 3단계 : 정면 + 좌우 옆모습 3컷 ──────────────────────────────────
must("""    <h2>3단계 · 전신 사진 올리기</h2>
    <p class="sub">머리부터 발끝까지 모두 나온 <b>정면 전신</b> 사진을 올려주세요. 체형·골격·비율·얼굴형을 분석해 코디와 헤어를 추천합니다.</p>

    <ul class="guide-list" style="margin-bottom:16px">
      <li><span class="ic">🧱</span><span><b>단색 벽</b> 앞에서 촬영하면 실루엣 인식률이 크게 올라갑니다.</span></li>
      <li><span class="ic">🦶</span><span><b>발끝까지</b> 프레임 안에 넣고 아래 여백을 조금 두세요.</span></li>
      <li><span class="ic">🧍</span><span>팔은 몸에서 살짝 떼고, 몸에 <b>붙는 옷</b>일수록 정확합니다.</span></li>
      <li><span class="ic">📐</span><span>카메라는 <b>허리 높이</b>에서 수평으로. 위에서 찍으면 비율이 왜곡됩니다.</span></li>
    </ul>

    <button type="button" class="drop" id="dropFull" aria-describedby="dropFullDesc">
      <div class="big">
        <svg viewBox="0 0 44 44" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="22" cy="8.5" r="4.5"/><path d="M22 13v14M22 17l-8 4M22 17l8 4M22 27l-4.5 12M22 27l4.5 12"/></svg>
      </div>
      <div class="t">전신 사진을 여기에 놓거나 클릭해 선택</div>
      <div class="d" id="dropFullDesc">단색 배경일수록 정확합니다</div>
    </button>
    <input type="file" id="fileFull" accept="image/*" class="hidden" tabindex="-1">
""",
"""    <h2>3단계 · 전신 사진 올리기</h2>
    <p class="sub"><b>정면</b> 한 장이면 체형·비율 분석과 가상 피팅이 됩니다.
    여기에 <b>양옆으로 돌아선 사진</b>을 더하면 몸의 <b>앞뒤 두께</b>를 재서
    둘레까지 계산하고, 옷이 몸을 감싸는 모양도 훨씬 정확해집니다.</p>

    <ul class="guide-list" style="margin-bottom:16px">
      <li><span class="ic">🧱</span><span><b>단색 벽</b> 앞에서 촬영하면 실루엣 인식률이 크게 올라갑니다.</span></li>
      <li><span class="ic">🦶</span><span><b>발끝까지</b> 프레임 안에 넣고 아래 여백을 조금 두세요.</span></li>
      <li><span class="ic">🧍</span><span>팔은 몸에서 살짝 떼고, 몸에 <b>붙는 옷</b>일수록 정확합니다.</span></li>
      <li><span class="ic">📐</span><span>카메라는 <b>허리 높이</b>에서 수평으로. 위에서 찍으면 비율이 왜곡됩니다.</span></li>
      <li><span class="ic">🔄</span><span>옆모습은 <b>제자리에서 몸만</b> 돌리세요. 카메라와 거리가 달라지면 두께가 틀어집니다.
        <b>완전히 옆으로</b> 돌아야 합니다 — 비스듬히 서면 두께가 실제보다 두껍게 나옵니다.</span></li>
    </ul>

    <div class="mv-slots">
      <button type="button" class="drop mv-drop" id="dropFull" aria-describedby="dropFullDesc">
        <span class="mv-tag req">필수</span>
        <div class="big">
          <svg viewBox="0 0 44 44" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="22" cy="8.5" r="4.5"/><path d="M22 13v14M22 17l-8 4M22 17l8 4M22 27l-4.5 12M22 27l4.5 12"/></svg>
        </div>
        <div class="t">정면</div>
        <div class="d" id="dropFullDesc">머리부터 발끝까지</div>
        <canvas class="mv-thumb hidden"></canvas>
      </button>
      <button type="button" class="drop mv-drop" id="dropSideL">
        <span class="mv-tag">선택</span>
        <div class="big">
          <svg viewBox="0 0 44 44" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="19" cy="8.5" r="4.5"/><path d="M19 13v14M19 17l-4 5M19 27l-3 12M19 27l3 12"/><path d="M31 6a16 16 0 0 1 0 32" stroke-dasharray="3 3"/></svg>
        </div>
        <div class="t">왼쪽 옆모습</div>
        <div class="d">왼쪽으로 90° 돌아서</div>
        <canvas class="mv-thumb hidden"></canvas>
      </button>
      <button type="button" class="drop mv-drop" id="dropSideR">
        <span class="mv-tag">선택</span>
        <div class="big">
          <svg viewBox="0 0 44 44" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="25" cy="8.5" r="4.5"/><path d="M25 13v14M25 17l4 5M25 27l3 12M25 27l-3 12"/><path d="M13 6a16 16 0 0 0 0 32" stroke-dasharray="3 3"/></svg>
        </div>
        <div class="t">오른쪽 옆모습</div>
        <div class="d">오른쪽으로 90° 돌아서</div>
        <canvas class="mv-thumb hidden"></canvas>
      </button>
    </div>
    <input type="file" id="fileFull" accept="image/*" class="hidden" tabindex="-1">
    <input type="file" id="fileSideL" accept="image/*" class="hidden" tabindex="-1">
    <input type="file" id="fileSideR" accept="image/*" class="hidden" tabindex="-1">
    <div id="mvPanel"></div>
""", 'step3-markup')

# ── 7. 앱 : 슬롯별 처리 + 다각도 계산 ──────────────────────────────────
must("  wireDrop('#dropFull', '#fileFull', handleFull);",
"""  wireDrop('#dropFull', '#fileFull', function (f) { handleFullSlot(f, 0); });
  wireDrop('#dropSideL', '#fileSideL', function (f) { handleFullSlot(f, 1); });
  wireDrop('#dropSideR', '#fileSideR', function (f) { handleFullSlot(f, 2); });""", 'slot-wire')

must("""  function handleFull(file) {
    var drop = $('#dropFull');
    drop.querySelector('.t').textContent = '분석 중…';
    announce('사진을 분석하고 있습니다.');
    loadImage(file).then(function (img) {
      drop.querySelector('.t').textContent = '전신 사진을 여기에 놓거나 클릭해 선택';
      var body = BODY.analyzeFull(img, { gender: state.opts.gender });
      $('#fullPreview').classList.remove('hidden');
      $('#fullIssues').innerHTML = issuesHtml(body.issues);
      if (!body.ok) { $('#go4').disabled = true; return; }
      $('#go4').disabled = false;
      // 원본 이미지를 함께 들고 있는다. 체형 분석은 640px면 충분하지만
      // 가상 피팅은 눈으로 보는 결과물이라 그 해상도로는 거칠다.
      state.full = { work: body.work, body: body, img: img, lines: cloneLines(body.landmarks) };
      drawFull();
      $('#fullSummary').innerHTML = REPORT.bodySummary(body);
    }).catch(function (err) {
      drop.querySelector('.t').textContent = '전신 사진을 여기에 놓거나 클릭해 선택';
      $('#fullPreview').classList.remove('hidden');
      $('#fullIssues').innerHTML = issuesHtml([{ level: 'fatal', ko: '파일을 읽지 못했습니다: ' + err.message }]);
    });
  }""",
"""  var SLOT_KO = ['정면', '왼쪽 옆모습', '오른쪽 옆모습'];
  var SLOT_DROP = ['#dropFull', '#dropSideL', '#dropSideR'];

  function handleFullSlot(file, slot) {
    var drop = $(SLOT_DROP[slot]);
    var label = drop.querySelector('.t'), was = label.textContent;
    label.textContent = '분석 중…';
    announce(SLOT_KO[slot] + ' 사진을 분석하고 있습니다.');

    loadImage(file).then(function (img) {
      label.textContent = SLOT_KO[slot];
      var body = BODY.analyzeFull(img, { gender: state.opts.gender });

      if (!state.full) state.full = { views: [null, null, null] };
      if (!state.full.views) state.full.views = [null, null, null];

      if (slot === 0) {
        $('#fullPreview').classList.remove('hidden');
        $('#fullIssues').innerHTML = issuesHtml(body.issues);
        if (!body.ok) { $('#go4').disabled = true; return; }
        $('#go4').disabled = false;
        // 원본 이미지를 함께 들고 있는다. 체형 분석은 640px면 충분하지만
        // 가상 피팅은 눈으로 보는 결과물이라 그 해상도로는 거칠다.
        state.full.work = body.work;
        state.full.body = body;
        state.full.img = img;
        state.full.lines = cloneLines(body.landmarks);
        drawFull();
        $('#fullSummary').innerHTML = REPORT.bodySummary(body);
      } else if (!body.ok) {
        // 옆모습은 선택이므로 전체를 막지 않는다. 이 컷만 버린다.
        state.full.views[slot] = null;
        drawSlotThumb(slot, null);
        renderMvPanel([{ level: 'warn', ko: SLOT_KO[slot] + '에서 몸을 인식하지 못해 이 사진은 쓰지 않습니다. 단색 배경에서 발끝까지 나오게 다시 찍어 주세요.' }]);
        return;
      }

      state.full.views[slot] = { img: img, body: body };
      drawSlotThumb(slot, body);
      runMultiview();
    }).catch(function (err) {
      label.textContent = was;
      if (slot === 0) {
        $('#fullPreview').classList.remove('hidden');
        $('#fullIssues').innerHTML = issuesHtml([{ level: 'fatal', ko: '파일을 읽지 못했습니다: ' + err.message }]);
      } else {
        renderMvPanel([{ level: 'fatal', ko: SLOT_KO[slot] + ' 파일을 읽지 못했습니다: ' + err.message }]);
      }
    });
  }

  /** 슬롯에 작은 미리보기 — 어떤 사진을 넣었는지 눈으로 확인되어야 한다 */
  function drawSlotThumb(slot, body) {
    var cv = $(SLOT_DROP[slot]).querySelector('.mv-thumb');
    if (!cv) return;
    if (!body) { cv.classList.add('hidden'); return; }
    var src = body.work.canvas;
    var hgt = 74, sc = hgt / src.height;
    cv.width = Math.max(1, Math.round(src.width * sc));
    cv.height = hgt;
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    cv.classList.remove('hidden');
    $(SLOT_DROP[slot]).classList.add('filled');
  }

  /** 옆모습이 하나라도 있으면 앞뒤 두께를 계산한다 */
  function runMultiview(angles) {
    var f = state.full;
    if (!f || !f.views || !f.views[0]) return;
    if (!f.views[1] && !f.views[2]) { renderMvPanel(); return; }
    var hEl = $('#mHeight');
    var opts = {
      heightCm: hEl && hEl.value ? parseFloat(hEl.value) : null,
      angles: angles || state.mvAngles || null,
      tape: {
        bust: ($('#mBust') || {}).value, waist: ($('#mWaist') || {}).value,
        hip: ($('#mHip') || {}).value
      }
    };
    try {
      f.mv = MULTIVIEW.solve(f.views, opts);
    } catch (e) {
      f.mv = null;
      renderMvPanel([{ level: 'fatal', ko: '두께 계산 중 오류가 났습니다: ' + e.message }]);
      return;
    }
    if (angles) state.mvAngles = angles;
    renderMvPanel();
  }

  function renderMvPanel(extra) {
    var host = $('#mvPanel'); if (!host) return;
    FITROOM.mvPanel(host, state.full && state.full.mv, {
      extra: extra || [],
      hasSide: !!(state.full && state.full.views && (state.full.views[1] || state.full.views[2])),
      onAngles: function (ang) { runMultiview(ang); }
    });
  }""", 'slot-handler')

must("  $('#reFull').onclick = function () { $('#fileFull').value = ''; $('#fileFull').click(); };",
"""  $('#reFull').onclick = function () { $('#fileFull').value = ''; $('#fileFull').click(); };
  // 키를 넣으면 둘레를 cm로 낼 수 있게 된다 — 넣는 즉시 다시 계산한다
  ['#mHeight', '#mBust', '#mWaist', '#mHip'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('change', function () { runMultiview(); });
  });""", 'height-hook')

must("""    $('#fileBust').value = ''; $('#fileFull').value = '';""",
"""    $('#fileBust').value = ''; $('#fileFull').value = '';
    ['#fileSideL', '#fileSideR'].forEach(function (id) { if ($(id)) $(id).value = ''; });
    state.mvAngles = null;
    SLOT_DROP.forEach(function (d, i) {
      var el = $(d); if (!el) return;
      el.classList.remove('filled');
      var c = el.querySelector('.mv-thumb'); if (c) c.classList.add('hidden');
      var t = el.querySelector('.t'); if (t) t.textContent = SLOT_KO[i];
    });
    if ($('#mvPanel')) $('#mvPanel').innerHTML = '';""", 'reset')

# 리포트로 다각도 결과를 넘긴다
must("""        REPORT.mountFullReport(el, b.dx, bodyOk, state.rec, b.feat, state.opts.goal,
          state.full ? state.full.img : null);""",
"""        REPORT.mountFullReport(el, b.dx, bodyOk, state.rec, b.feat, state.opts.goal,
          state.full ? state.full.img : null, state.full || null);""", 'report-mv')

out = ROOT / '퍼스널컬러진단.html'

out.write_text(s, encoding='utf-8')
print(f"built {out.name}  ({len(s.encode('utf-8')) / 1024:.0f} KB)")
