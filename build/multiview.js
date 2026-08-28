/* =========================================================================
 * multiview.js — 여러 각도의 전신 사진에서 몸의 앞뒤 두께를 **잰다**
 *
 * 이 도구가 스스로 적어 둔 가장 큰 한계는 이것이었다.
 *
 *   "정면 사진 한 장에서 몸의 3D 형태를 알 수 없다.
 *    옷은 실루엣 폭에만 맞춰지며 앞뒤 두께는 반영되지 않는다."
 *
 * 사진을 한 장 더 주면 이 한계가 사라진다. 정확히는, **추정이 계산이 된다.**
 *
 * ── 원리 ────────────────────────────────────────────────────────────────
 * 몸통의 가로 단면을 생각하자. 반폭 a(좌우), 반두께 b(앞뒤).
 * 이 사람이 수직축을 중심으로 θ만큼 돌아서면 실루엣 반폭은
 *
 *      w(θ) = √( a²cos²θ + b²sin²θ )      (단면이 타원일 때)
 *
 * 정면(θ=0)은 w = a 를 준다. 남은 미지수는 b 와 θ 다.
 *
 * ── 처음에 틀렸던 접근 ─────────────────────────────────────────────────
 * "좌우 두 장을 주면 두 각도와 두께를 함께 풀 수 있다"고 설계했다가
 * 실측에서 각도가 탐색 상한(85°)에 눌러앉는 것을 보고 알았다 —
 * **좌우 대칭으로 돌면 어떤 각도를 넣어도 좌우가 똑같이 맞는다.**
 * 두 사진의 일치는 각도에 대해 아무 정보도 주지 않는다(1-매개변수 축퇴).
 *
 * ── 실제로 쓰는 방법 : 옆모습 ──────────────────────────────────────────
 * 45°가 아니라 **옆으로 돌아선 사진**을 받는다. θ=90°에서
 *
 *      w(90°) = b                      ← 두께를 그대로 준다
 *      dw/dθ  = 0                      ← 각도 오차에 1차적으로 둔감하다
 *
 * 두 번째 성질이 결정적이다. 완전히 90°가 아니어도 된다. a=0.10, b=0.07 인
 * 몸통을 80°로만 돌아서 찍어도 측정 두께는 0.0711 — 참값 대비 1.5% 오차다.
 * 각도를 정확히 맞추라고 요구하는 대신 **각도에 둔감한 지점에서 잰다.**
 *
 * 더 좋은 점이 하나 더 있다. θ=90° 에서는 어떤 단면 모양이든
 * w = b 다(타원이든 초타원이든 지지함수가 같다). 즉 **두께 자체는
 * 단면 가정과 무관하게 측정된다.** 타원 가정은 두께를 둘레로 바꿀 때만
 * 들어온다.
 *
 * ── 그러면 좌우 두 장은 왜 받는가 ──────────────────────────────────────
 * 각도를 풀기 위해서가 아니라 **검산하기 위해서**다. 같은 사람의 같은
 * 몸통이므로 왼쪽에서 잰 두께와 오른쪽에서 잰 두께는 같아야 한다.
 * 벌어지면 자세가 틀어졌거나 한쪽이 덜 돌아간 것이고, 그 사실을 보고한다.
 * README가 말하는 "정답을 몰라도 참인 성질"을 하나 더 얻는 셈이다.
 *
 * ── 정직한 한계 ─────────────────────────────────────────────────────────
 * · 두께는 잰다. 하지만 **둘레**로 바꿀 때는 단면이 타원이라는 가정이
 *   들어간다. 실제 허리 단면은 타원보다 각져 있어 타원 둘레는 대체로
 *   과소평가한다. 줄자 실측을 하나라도 넣으면 그 비율로 나머지를 보정한다.
 * · 옷 두께가 그대로 더해진다. 몸에 붙는 옷일수록 정확하다.
 * · 옆모습에서 팔이 몸통 앞뒤로 튀어나오면 두께가 부풀어 오른다.
 * · 덜 돌아선 사진은 두께를 과대평가한다. b/a 가 사람의 범위를 벗어나면
 *   그 사실을 감지해 경고한다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var clamp = CC.clamp;
  var DEG = Math.PI / 180;

  /* 몸통을 몇 개 높이에서 재는가. 너무 촘촘하면 노이즈만 늘고,
   * 너무 성기면 가슴·허리의 변화를 놓친다. */
  var LEVELS = 15;

  /* =======================================================================
   * 1. 높이 정규화 — 세 장의 사진은 크기도 위치도 다르다
   *
   * 같은 사람이라도 한 걸음 다가서면 픽셀 크기가 달라진다. 그래서 픽셀이
   * 아니라 **해부학적 위치**로 맞춘다. 어깨선을 0, 골반선을 1로 두고 그
   * 사이를 등분하면, 어느 사진의 0.5든 같은 신체 부위를 가리킨다.
   *
   * 폭도 픽셀이 아니라 **몸 전체 높이 대비 비율**로 잰다. 돌아서도 키는
   * 변하지 않으므로 이 기준은 회전에 영향받지 않는다.
   * ===================================================================== */
  function profileOf(bodyRes) {
    if (!bodyRes || !bodyRes.ok) return null;
    var L = TRYON.saneLM(bodyRes.landmarks);
    var rows = bodyRes.rows, h = bodyRes.work.h;
    var H = Math.max(1, L.bottom - L.top);
    var win = Math.max(1, Math.round(H * 0.018));

    var half = new Float64Array(LEVELS);
    var cx = new Float64Array(LEVELS);
    var ok = true;

    for (var i = 0; i < LEVELS; i++) {
      var t = i / (LEVELS - 1);
      var y = Math.round(L.shoulder.y + t * (L.hip.y - L.shoulder.y));
      /* 창을 어깨~골반 **안쪽으로** 가둔다.
       * 골반선에서 아래로 창이 넘어가면 다리가 갈라진 행을 함께 읽는데,
       * 그 행의 최장 구간은 다리 한 짝이라 폭이 통째로 작아진다.
       * 실측에서 골반 둘레가 11cm 과소평가된 원인이었다. */
      var lo = Math.round(L.shoulder.y), hi = Math.round(L.hip.y);
      var ws = [], cs = [];
      for (var k = -win; k <= win; k++) {
        if (y + k < lo || y + k > hi) continue;
        // body.js 의 행 필드는 coreX0/coreX1 이다(tryon.js 의 prepare 가 쓰는
        // cx0/cx1 과 이름이 다르다). 잘못 읽으면 조용히 NaN이 되어 각도가
        // 탐색 하한에 눌러앉는다 — 실제로 그랬다.
        var r = rows[clamp(y + k, 0, h - 1)];
        if (!r || r.coreX0 == null || r.coreX0 < 0) continue;
        ws.push((r.coreX1 - r.coreX0 + 1) / 2);
        cs.push((r.coreX0 + r.coreX1) / 2);
      }
      if (ws.length < 2) {                      // 창이 너무 좁아졌으면 그 행만
        var rr = rows[clamp(y, 0, h - 1)];
        if (rr && rr.coreX0 >= 0) {
          ws = [(rr.coreX1 - rr.coreX0 + 1) / 2];
          cs = [(rr.coreX0 + rr.coreX1) / 2];
        }
      }
      if (!ws.length) { ok = false; break; }
      ws.sort(function (a, b) { return a - b; });
      cs.sort(function (a, b) { return a - b; });
      /* 팔이 몸통에 겹치면 최장 구간이 부풀어 오른다. 중앙값보다 아래인
       * 30 퍼센타일을 쓰면 그 오염을 상당 부분 걷어낸다 — 팔은 폭을
       * 늘리기만 하지 줄이지 않기 때문이다. */
      half[i] = ws[Math.floor(ws.length * 0.30)] / H;
      cx[i] = cs[cs.length >> 1];
    }
    if (!ok) return null;
    for (var q = 0; q < LEVELS; q++) {
      if (!isFinite(half[q]) || half[q] <= 0) return null;   // 조용한 NaN 차단
    }

    return {
      half: half, cx: cx, H: H, lm: L, head: headWidth(rows, L, h, H),
      levelY: function (t) { return L.shoulder.y + t * (L.hip.y - L.shoulder.y); }
    };
  }

  /**
   * 머리의 실루엣 폭 (키 대비 비율).
   *
   * 머리는 **얼마나 돌아섰는지 알려주는 유일하게 믿을 만한 신호**다.
   * 몸통의 앞뒤/좌우 비는 사람마다 크게 다르지만, 머리의 앞뒤 길이 대비
   * 좌우 폭(두개지수)은 성인 사이에서 훨씬 좁은 범위에 있다.
   * 정수리 근처는 둥글어 폭이 급격히 변하므로 머리 높이의 25~75 % 구간에서
   * 가장 넓은 곳을 쓴다.
   */
  function headWidth(rows, L, h, H) {
    /* 턱 위치(chinY)에 기대지 않는다.
     * chinY 는 피부색 기반 얼굴 검출에서 나오는데, 그 검출이 빗나가면
     * 창이 어깨까지 내려가 어깨 폭을 머리 폭으로 읽는다 — 실측에서
     * 머리 폭이 키의 20%(=어깨 폭)로 나왔다.
     * 대신 **키 대비 고정 구간**을 쓴다. 성인은 6.5~8등신이라 머리는
     * 정수리에서 키의 12% 안에 들어가고, 어깨는 그보다 아래에 있다. */
    var a = Math.round(L.top + H * 0.02);
    var b = Math.round(L.top + H * 0.12);
    var mx = 0;
    for (var y = a; y <= b; y++) {
      var r = rows[clamp(y, 0, h - 1)];
      if (!r || r.coreX0 == null || r.coreX0 < 0) continue;
      mx = Math.max(mx, r.coreX1 - r.coreX0 + 1);
    }
    // 머리가 키의 6~12% 폭을 벗어나면 머리를 잡은 것이 아니다 — 쓰지 않는다
    var w = mx / H;
    return (w > 0.05 && w < 0.15) ? w : null;
  }

  /* =======================================================================
   * 2. 두께 역산
   *
   * 각도를 알면 두께는 바로 나온다.
   *      b² = ( w² − a²cos²θ ) / sin²θ
   * θ=90° 이면 b = w 로 단순해진다. 이것이 옆모습을 받는 이유다.
   * ===================================================================== */
  /** 한 각도에서 두께를 역산. 불가능한 값이 나오면 벌점을 매겨 돌려준다. */
  function depthFrom(a, w, deg) {
    var th = deg * DEG, c2 = Math.cos(th) * Math.cos(th), s2 = Math.sin(th) * Math.sin(th);
    if (s2 < 1e-4) return null;
    var b = new Float64Array(LEVELS), pen = 0;
    for (var i = 0; i < LEVELS; i++) {
      var v = (w[i] * w[i] - a[i] * a[i] * c2) / s2;
      if (v < 0) {
        /* 돌아선 쪽이 정면보다 좁다 — 이 각도에서는 있을 수 없는 일이다.
         * 버리지 않고 0으로 두되 얼마나 모순인지 벌점으로 남긴다. */
        pen += Math.sqrt(-v);
        v = 0;
      }
      b[i] = Math.sqrt(v);
    }
    /* 두께가 폭보다 크면(b > a) 사람 몸통이 아니다. 완만하게 벌점. */
    for (var j = 0; j < LEVELS; j++) {
      if (b[j] > a[j] * 1.25) pen += (b[j] - a[j] * 1.25);
    }
    return { b: b, penalty: pen / LEVELS };
  }

  /* =======================================================================
   * 3. 둘레 — 타원 둘레 근사 (Ramanujan 제2근사)
   *
   * 오차가 상대적으로 3e-5 수준이라 이 용도에는 넘치도록 정확하다.
   * 정확하지 않은 것은 공식이 아니라 **단면이 타원이라는 가정**이다.
   * ===================================================================== */
  function ellipsePerimeter(a, b) {
    if (a <= 0 || b < 0) return 0;
    var h = Math.pow((a - b) / (a + b), 2);
    return Math.PI * (a + b) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)));
  }

  /**
   * 픽셀 비율을 cm로 바꾼다. 기준은 사용자가 입력한 키뿐이다.
   * 키가 없으면 cm를 만들어내지 않고 비율만 돌려준다 — 없는 근거로
   * 숫자를 찍어내지 않는다는 이 도구의 규칙 그대로다.
   */
  function circumferences(front, depth, heightCm) {
    var L = front.lm;
    var levels = { bust: null, waist: null, hip: null };
    var yb = L.bust ? L.bust.y : (L.shoulder.y + L.waist.y) / 2;
    var span = Math.max(1, L.hip.y - L.shoulder.y);
    var tOf = function (y) { return clamp((y - L.shoulder.y) / span, 0, 1); };
    var idxOf = function (t) { return clamp(Math.round(t * (LEVELS - 1)), 0, LEVELS - 1); };

    var picks = {
      bust: idxOf(tOf(yb)),
      waist: idxOf(tOf(L.waist.y)),
      hip: idxOf(tOf(L.hip.y))
    };
    var out = { ratios: {}, cm: null, picks: picks };
    Object.keys(picks).forEach(function (k) {
      var i = picks[k];
      var a = front.half[i], b = depth[i];
      out.ratios[k] = { a: a, b: b, depthRatio: a > 0 ? b / a : 0, perim: ellipsePerimeter(a, b) };
    });
    if (heightCm && heightCm > 80 && heightCm < 230) {
      // half[] 는 이미 "몸 전체 높이 대비" 비율이므로 키를 곱하면 cm가 된다
      out.cm = {};
      Object.keys(picks).forEach(function (k) {
        out.cm[k] = out.ratios[k].perim * heightCm;
      });
    }
    return out;
  }

  /* =======================================================================
   * 4. 메인
   *
   * views[0] 이 정면. 나머지는 돌아선 컷(좌·우 순서는 상관없다).
   * ===================================================================== */
  function solve(views, opts) {
    opts = opts || {};
    var issues = [];
    var profs = views.map(function (v) { return v ? profileOf(v.body) : null; });
    var front = profs[0];
    if (!front) {
      return { ok: false, issues: [{ level: 'fatal', ko: '정면 사진에서 몸통을 인식하지 못했습니다.' }] };
    }
    var turned = [];
    for (var t = 1; t < profs.length; t++) if (profs[t]) turned.push({ prof: profs[t], slot: t });
    if (!turned.length) {
      return {
        ok: false, single: true, front: front,
        issues: [{ level: 'info', ko: '옆모습 사진이 없어 앞뒤 두께는 계산하지 않았습니다. 왼쪽·오른쪽 옆모습을 한 장씩 더 올리면 두께와 둘레까지 잽니다.' }]
      };
    }

    /* 각도는 기본 90°(옆모습). 사용자가 슬라이더로 바꾸면 그 값을 쓴다.
     * 90° 근처에서는 각도 오차가 두께에 거의 영향을 주지 않는다. */
    var angles = turned.map(function (tv, i) {
      var g = opts.angles && opts.angles[i];
      return clamp(g == null ? 90 : g, 20, 90);
    });

    var each = [], pen = 0;
    for (var k = 0; k < turned.length; k++) {
      var r = depthFrom(front.half, turned[k].prof.half, angles[k]);
      if (!r) {
        return { ok: false, issues: [{ level: 'fatal', ko: '옆모습에서 두께를 읽지 못했습니다.' }] };
      }
      each.push(r.b); pen += r.penalty;
    }
    pen /= turned.length;

    var depthRaw = new Float64Array(LEVELS), spreadSum = 0;
    for (var i2 = 0; i2 < LEVELS; i2++) {
      var acc = 0;
      for (var m = 0; m < each.length; m++) acc += each[m][i2];
      depthRaw[i2] = acc / each.length;
      if (each.length >= 2) spreadSum += Math.pow(each[0][i2] - each[1][i2], 2);
    }
    var spreadAbs = each.length >= 2 ? Math.sqrt(spreadSum / LEVELS) : null;

    /* 두께 프로파일을 부드럽게 — 한 높이의 튐이 옷 전체를 흔들지 않게 */
    var depth = smooth(depthRaw, 2);

    var meanA = 0, meanB = 0;
    for (var q = 0; q < LEVELS; q++) { meanA += front.half[q]; meanB += depth[q]; }
    meanA /= LEVELS; meanB /= LEVELS;
    var spreadRel = spreadAbs == null ? null : spreadAbs / Math.max(1e-6, meanA);
    var penRel = pen / Math.max(1e-6, meanA);
    var ratio = meanB / Math.max(1e-6, meanA);

    /* 신뢰도는 모델이 매긴 확률이 아니라 **두 관측이 얼마나 맞아떨어졌는가**다 */
    var conf = 0.86;
    if (spreadRel != null) conf -= clamp(spreadRel * 1.8, 0, 0.55);
    else { conf = Math.min(conf, 0.55); }
    conf -= clamp(penRel * 1.2, 0, 0.35);

    if (turned.length < 2) {
      issues.push({ level: 'warn', ko: '옆모습이 한 장뿐이라 좌우 대조를 할 수 없습니다. 반대쪽도 올리면 두께를 검산할 수 있습니다.' });
    }
    if (spreadRel != null && spreadRel > 0.16) {
      issues.push({ level: 'warn', ko: '왼쪽과 오른쪽에서 잰 두께가 ' + (spreadRel * 100).toFixed(0) +
        '% 어긋납니다. 한쪽이 덜 돌아갔거나 자세가 틀어졌습니다 — 두께를 확정적으로 쓰지 마세요.' });
      conf = Math.min(conf, 0.45);
    }
    /* b/a 가 사람의 범위를 벗어나면 "덜 돌아선 사진"이라는 뜻이다.
     * 성인 몸통의 앞뒤 두께는 좌우 폭의 대략 절반~4분의 3이다. */
    if (ratio > 0.95) {
      issues.push({ level: 'warn', ko: '옆모습의 폭이 정면과 거의 같습니다. 덜 돌아선 사진일 가능성이 큽니다 — ' +
        '몸을 완전히 옆으로 돌려 다시 찍거나, 아래 각도를 조절해 주세요.' });
      conf = Math.min(conf, 0.30);
    } else if (ratio < 0.38) {
      issues.push({ level: 'warn', ko: '두께가 폭의 ' + (ratio * 100).toFixed(0) +
        '% 로 이례적으로 얇습니다. 옆모습에서 몸통이 제대로 잡히지 않았을 수 있습니다.' });
      conf = Math.min(conf, 0.40);
    }
    if (penRel > 0.06) {
      issues.push({ level: 'warn', ko: '옆모습의 폭이 정면보다 넓게 나온 구간이 있습니다. 카메라 거리가 달라졌을 수 있습니다.' });
    }

    /* ── 머리로 "충분히 돌아섰는가"를 검사한다 ─────────────────────────
     * 각도를 이것으로 **추정하지는 않는다.** 90° 근처에서 sin²θ 가 평평해
     * 머리에서 나온 각도의 오차가 크고, 그 각도를 그대로 쓰면 90°로 두는
     * 것보다 오히려 나빠진다. 대신 "덜 돌아선 사진"을 잡아내는 데만 쓴다.
     *
     *   w_head(θ)² = Hb²(cos²θ + k²sin²θ),  k = 앞뒤길이/좌우폭 ≈ 1.28
     *   → r = w_turned/w_front 는 90°에서 1.28, 45°에서 1.15
     * 두 값이 뚜렷이 갈리므로 45° 컷을 잡아낼 수 있다. */
    var HEAD_K = 1.28;
    if (front.head) {
      var rs = [];
      for (var hi = 0; hi < turned.length; hi++) {
        var hw = turned[hi].prof.head;
        if (hw) rs.push(hw / front.head);
      }
      if (rs.length) {
        var rMean = rs.reduce(function (x, y2) { return x + y2; }, 0) / rs.length;
        var s2 = clamp((rMean * rMean - 1) / (HEAD_K * HEAD_K - 1), 0, 1);
        var headDeg = Math.asin(Math.sqrt(s2)) / DEG;
        if (rMean < 1.19) {
          issues.push({ level: 'warn', ko: '머리 폭으로 보면 약 ' + headDeg.toFixed(0) +
            '° 밖에 돌아서지 않았습니다. 옆모습(90°)을 전제로 계산했으므로 두께가 ' +
            '실제보다 크게 나옵니다 — 완전히 옆으로 돌아 다시 찍거나 아래 각도를 조절해 주세요.' });
          conf = Math.min(conf, 0.35);
        }
      }
    }

    var circ = circumferences(front, depth, opts.heightCm);
    if (opts.tape) calibrate(circ, opts.tape, issues);

    return {
      ok: true,
      front: front, profiles: profs,
      angles: angles,                           // 옆모습들의 각도(도) — 기본 90
      depth: depth,                             // 높이별 반두께 (키 대비 비율)
      halfFront: front.half,                    // 높이별 반폭   (키 대비 비율)
      perSide: each,                            // 좌·우가 각각 내놓은 두께
      depthRatio: ratio,                        // 몸통 평균 b/a
      depthRatioAt: function (t) {              // 0=어깨 … 1=골반
        var idx = clamp(t * (LEVELS - 1), 0, LEVELS - 1);
        var i0 = Math.floor(idx), i1 = Math.min(LEVELS - 1, i0 + 1), f = idx - i0;
        var a0 = front.half[i0], a1 = front.half[i1];
        var r0 = a0 > 0 ? depth[i0] / a0 : ratio;
        var r1 = a1 > 0 ? depth[i1] / a1 : ratio;
        return clamp(r0 + (r1 - r0) * f, 0.25, 1.25);
      },
      spread: spreadRel, penalty: penRel,
      confidence: clamp(conf, 0.05, 0.90),
      circ: circ, levels: LEVELS, heightCm: opts.heightCm || null, issues: issues
    };
  }

  /**
   * 줄자 실측이 하나라도 있으면 그 비율로 나머지를 보정한다.
   *
   * 타원 둘레는 실제 몸통보다 대체로 작게 나온다 — 허리 단면이 타원보다
   * 각져 있기 때문이다. 그 편차는 사람마다 다르지만 **한 사람 안에서는
   * 높이별로 비슷하다.** 그래서 한 곳만 재면 나머지를 끌어올릴 수 있다.
   * 없는 근거로 숫자를 만드는 것이 아니라, 있는 관측 하나를 최대한 쓰는 것이다.
   */
  function calibrate(circ, tape, issues) {
    if (!circ.cm) return;
    var keys = ['waist', 'bust', 'hip'], ref = null;
    for (var i = 0; i < keys.length; i++) {
      var v = parseFloat(tape[keys[i]]);
      if (isFinite(v) && v > 40 && v < 200 && circ.cm[keys[i]] > 10) {
        ref = { key: keys[i], tape: v, model: circ.cm[keys[i]] };
        break;
      }
    }
    if (!ref) return;
    var k = ref.tape / ref.model;
    if (k < 0.7 || k > 1.5) {
      issues.push({ level: 'warn', ko: '사진에서 계산한 둘레와 줄자 값이 ' +
        ((k - 1) * 100).toFixed(0) + '% 차이납니다. 키 입력이나 촬영 거리를 확인해 주세요.' });
      return;
    }
    circ.calibration = { key: ref.key, factor: k, tape: ref.tape, before: ref.model };
    Object.keys(circ.cm).forEach(function (kk) { circ.cm[kk] *= k; });
    circ.cm[ref.key] = ref.tape;
  }

  function smooth(arr, win) {
    var out = new Float64Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      var s = [], a = Math.max(0, i - win), b = Math.min(arr.length - 1, i + win);
      for (var j = a; j <= b; j++) s.push(arr[j]);
      s.sort(function (p, q) { return p - q; });
      out[i] = s[s.length >> 1];
    }
    return out;
  }

  /* =======================================================================
   * 5. 옷이 실제로 맞는가 — 둘레를 알게 되면서 처음 가능해진 판정
   *
   * 폭만 알 때는 "커 보인다/작아 보인다"밖에 말할 수 없었다. 둘레를 알면
   * 여유분을 cm로 말할 수 있다.
   * ===================================================================== */
  var EASE_KO = [
    { max: -2, key: 'tight', ko: '작습니다', note: '몸에 눌립니다. 한 치수 위를 권합니다.' },
    { max: 4, key: 'snug', ko: '딱 맞습니다', note: '몸의 선이 그대로 드러납니다.' },
    { max: 12, key: 'regular', ko: '적당합니다', note: '일반적인 착용감입니다.' },
    { max: 22, key: 'relaxed', ko: '여유롭습니다', note: '편안하지만 실루엣은 흐려집니다.' },
    { max: 1e9, key: 'oversized', ko: '많이 큽니다', note: '오버사이즈로 의도한 것이 아니라면 한 치수 아래를 권합니다.' }
  ];

  function fitVerdict(bodyCircCm, garmentCircCm) {
    if (!bodyCircCm || !garmentCircCm) return null;
    var ease = garmentCircCm - bodyCircCm;
    for (var i = 0; i < EASE_KO.length; i++) {
      if (ease <= EASE_KO[i].max) {
        return { ease: ease, key: EASE_KO[i].key, ko: EASE_KO[i].ko, note: EASE_KO[i].note };
      }
    }
    return null;
  }

  global.MULTIVIEW = {
    LEVELS: LEVELS,
    profileOf: profileOf, solve: solve, calibrate: calibrate,
    depthFrom: depthFrom, ellipsePerimeter: ellipsePerimeter,
    circumferences: circumferences, fitVerdict: fitVerdict, EASE_KO: EASE_KO
  };
})(window);
