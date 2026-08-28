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
    for f in ('garments.js', 'recolor.js', 'tryon.js')
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
"""  function mountFullReport(root, dx, body, rec, feat, goal, fullImage) {
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
          sourceImage: fullImage || null
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

out = ROOT / '퍼스널컬러진단.html'
out.write_text(s, encoding='utf-8')
print(f"built {out.name}  ({len(s.encode('utf-8')) / 1024:.0f} KB)")
