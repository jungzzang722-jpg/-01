/* =========================================================================
 * recolor.js — 소재 인식 기반 옷 색 변환 (반사율 분해 방식)
 *
 * "AI로 색을 바꾼다"는 말에는 두 가지 방법이 섞여 있다.
 *
 *  (A) 확산 모델(diffusion)에 옷을 다시 그리게 한다 — 상용 서비스가 쓰는 방식.
 *      품질은 가장 좋지만 GPU 서버와 수 GB 가중치가 필요하고, 무엇보다
 *      **사진을 서버로 보내야 한다.** 이 도구의 첫 번째 약속이 깨진다.
 *  (B) 옷의 픽셀을 조명 성분과 색 성분으로 **분해**한 뒤 색 성분만 갈아끼운다.
 *      브라우저 안에서 30ms 안에 끝나고 사진이 나가지 않는다.
 *
 * 이 파일은 (B)다. 그리고 (B)를 단순한 색조 덮어쓰기와 구별짓는 것은
 * 다음 네 가지다 — 이것이 없으면 옷이 아니라 색종이가 된다.
 *
 *  1. 음영 보존  — 픽셀의 밝기는 "옷 색 × 그 지점에 닿은 빛"이다.
 *                  비율(L/L̄)을 남기고 기준 밝기만 바꾸면 주름이 살아 있다.
 *  2. 채도 곡선  — 실제 직물은 깊은 그늘과 하이라이트에서 채도가 떨어진다.
 *                  전 픽셀에 같은 채도를 칠하면 플라스틱처럼 보인다.
 *  3. 정반사 보존 — 실크·레더의 하이라이트는 옷 색이 아니라 **광원 색**이다.
 *                  같이 물들이면 광택이 죽는다. 소재별로 남기는 양이 다르다.
 *  4. 군집 분리  — 스트라이프·프린트는 색이 여러 개다. 하나만 바꾸고
 *                  나머지는 그대로 둬야 무늬가 살아남는다.
 *
 * 군집화는 **명도 가중치를 낮춘 Lab 공간**에서 한다. 그냥 Lab에서 나누면
 * 같은 파란 옷의 밝은 면과 그늘진 면이 서로 다른 색으로 갈라진다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var clamp = CC.clamp;

  /* =======================================================================
   * 1. 소재별 색 변환 프로파일
   *
   * gamma      음영 대비. 1보다 크면 주름이 깊어지고 작으면 평평해진다.
   * specKeep   하이라이트를 원본 그대로 남기는 비율 (광택 보존)
   * specAt     어디부터를 하이라이트로 볼지 (군집 밝기 대비 배수)
   * chromaCap  이 소재가 낼 수 있는 최대 채도 (면은 실크만큼 선명해지지 않는다)
   * shadowDesat 그늘에서 채도가 빠지는 정도
   * residual   원본이 갖고 있던 미세한 색 흔들림을 남기는 양
   * ===================================================================== */
  var PROFILES = {
    cotton:  { ko: '면',       gamma: 1.00, specKeep: .10, specAt: 1.30, chromaCap: 62, shadowDesat: .55, residual: .18 },
    jersey:  { ko: '저지',     gamma: 0.96, specKeep: .08, specAt: 1.32, chromaCap: 58, shadowDesat: .52, residual: .16 },
    knit:    { ko: '니트',     gamma: 1.12, specKeep: .05, specAt: 1.40, chromaCap: 52, shadowDesat: .62, residual: .24 },
    wool:    { ko: '울',       gamma: 1.06, specKeep: .06, specAt: 1.38, chromaCap: 50, shadowDesat: .60, residual: .20 },
    denim:   { ko: '데님',     gamma: 1.10, specKeep: .12, specAt: 1.28, chromaCap: 55, shadowDesat: .50, residual: .30 },
    linen:   { ko: '린넨',     gamma: 1.04, specKeep: .10, specAt: 1.30, chromaCap: 56, shadowDesat: .55, residual: .26 },
    silk:    { ko: '실크',     gamma: 0.86, specKeep: .30, specAt: 1.16, chromaCap: 78, shadowDesat: .40, residual: .12 },
    leather: { ko: '레더',     gamma: 0.90, specKeep: .32, specAt: 1.14, chromaCap: 70, shadowDesat: .45, residual: .14 },
    tweed:   { ko: '트위드',   gamma: 1.14, specKeep: .05, specAt: 1.42, chromaCap: 48, shadowDesat: .64, residual: .34 },
    corduroy:{ ko: '코듀로이', gamma: 1.08, specKeep: .12, specAt: 1.26, chromaCap: 54, shadowDesat: .56, residual: .22 },
    tech:    { ko: '기능성',   gamma: 0.94, specKeep: .20, specAt: 1.20, chromaCap: 72, shadowDesat: .44, residual: .12 }
  };

  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* =======================================================================
   * 2. 색 군집 — 프린트·스트라이프를 살리기 위한 전제
   *
   * 거리를 (a, b, w·L)로 잰다. w를 1로 두면 조명이 만든 밝기 차이가
   * 색 차이로 오인돼 단색 옷이 3개 색으로 쪼개진다. w=0.30이면 무채색
   * 계열(흰/회/검)은 여전히 L로 갈라지고 유채색은 색상으로 갈라진다.
   * ===================================================================== */
  var LW = 0.30;

  function clusterColors(data, mask, w, h, k, maxSamples) {
    // 넉넉히 나눈 뒤 병합한다. 처음부터 k를 작게 잡으면 진짜 다른 색(스트라이프)이
    // 하나로 뭉개지고, 크게만 잡으면 단색이 쪼개진다. 나누고-합치는 편이 안전하다.
    k = k || 5;
    var pts = [], step = 1;
    var total = 0;
    for (var i = 0; i < mask.length; i++) if (mask[i]) total++;
    if (total === 0) return null;
    step = Math.max(1, Math.floor(total / (maxSamples || 6000)));

    var cnt = 0;
    for (var p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      if (cnt++ % step) continue;
      var idx = p * 4;
      var lab = CC.rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
      pts.push(lab);
    }
    if (pts.length < k) k = Math.max(1, pts.length);

    /* k-means++ 초기화 — 무작위 초기값은 실행할 때마다 결과가 달라진다 */
    var centers = [pts[Math.floor(pts.length / 2)]];
    while (centers.length < k) {
      var far = null, fd = -1;
      for (var j = 0; j < pts.length; j += 7) {
        var best = 1e9;
        for (var c = 0; c < centers.length; c++) best = Math.min(best, dist2(pts[j], centers[c]));
        if (best > fd) { fd = best; far = pts[j]; }
      }
      if (!far) break;
      centers.push(far);
    }
    for (var it = 0; it < 12; it++) {
      var acc = centers.map(function () { return { L: 0, a: 0, b: 0, n: 0 }; });
      for (var m = 0; m < pts.length; m++) {
        var bi = 0, bd = 1e9;
        for (var cc = 0; cc < centers.length; cc++) {
          var dd = dist2(pts[m], centers[cc]);
          if (dd < bd) { bd = dd; bi = cc; }
        }
        acc[bi].L += pts[m].L; acc[bi].a += pts[m].a; acc[bi].b += pts[m].b; acc[bi].n++;
      }
      centers = acc.map(function (s, ii) {
        return s.n ? { L: s.L / s.n, a: s.a / s.n, b: s.b / s.n } : centers[ii];
      });
    }

    /* 군집별 통계 — 명도 분포와 채도까지 재둔다 */
    var stats = centers.map(function () { return { n: 0, Ls: [] }; });
    for (var q = 0; q < pts.length; q++) {
      var bi2 = 0, bd2 = 1e9;
      for (var c2 = 0; c2 < centers.length; c2++) {
        var d2 = dist2(pts[q], centers[c2]);
        if (d2 < bd2) { bd2 = d2; bi2 = c2; }
      }
      stats[bi2].n++; stats[bi2].Ls.push(pts[q].L);
    }
    /* --- 병합 : 여기가 없으면 단색 옷이 세 색으로 쪼개진다 ---
     * 파란 셔츠의 밝은 면과 그늘진 면은 **같은 색**이다. 다른 것은 빛이다.
     * 그런데 k-means는 명도 축에서도 거리를 재므로 둘을 갈라놓는다. 그 상태로
     * "가장 넓은 군집"만 바꾸면 옷의 3분의 1만 색이 바뀐다.
     * 그래서 색상면(a,b)에서 가까운 군집을 다시 합친다 — 명도 차이는 무시한다. */
    var raw = centers.map(function (c, i) {
      var lch = CC.labToLch(c.L, c.a, c.b);
      return { lab: c, lch: lch, n: stats[i].n, Ls: stats[i].Ls };
    }).filter(function (c) { return c.n > 0; });

    var merged = [];
    raw.forEach(function (c) {
      for (var i = 0; i < merged.length; i++) {
        var m = merged[i];
        var da = c.lab.a - m.lab.a, db = c.lab.b - m.lab.b;
        var chromaGap = Math.sqrt(da * da + db * db);
        var bothGray = c.lch.C < 9 && m.lch.C < 9;
        var hueGap = CC.hueDist(c.lch.h, m.lch.h);
        // 무채색끼리는 색상각이 무의미하므로 색상면 거리만 본다
        if (chromaGap < 11 && (bothGray || hueGap < 24)) {
          var tn = m.n + c.n;
          m.lab = {
            L: (m.lab.L * m.n + c.lab.L * c.n) / tn,
            a: (m.lab.a * m.n + c.lab.a * c.n) / tn,
            b: (m.lab.b * m.n + c.lab.b * c.n) / tn
          };
          m.Ls = m.Ls.concat(c.Ls); m.n = tn;
          m.lch = CC.labToLch(m.lab.L, m.lab.a, m.lab.b);
          return;
        }
      }
      merged.push({ lab: c.lab, lch: c.lch, n: c.n, Ls: c.Ls.slice() });
    });

    var out = merged.map(function (c) {
      var Ls = c.Ls.slice().sort(function (a, b) { return a - b; });
      var lch = CC.labToLch(c.lab.L, c.lab.a, c.lab.b);
      return {
        lab: c.lab, hex: CC.labToHex(c.lab), C: lch.C, hue: lch.h,
        share: c.n / pts.length,
        p10: Ls.length ? Ls[Math.floor(Ls.length * .10)] : c.lab.L,
        p50: Ls.length ? Ls[Math.floor(Ls.length * .50)] : c.lab.L,
        p90: Ls.length ? Ls[Math.floor(Ls.length * .90)] : c.lab.L,
        achromatic: lch.C < 8
      };
    }).filter(function (c) { return c.share > 0.02; })
      .sort(function (a, b) { return b.share - a.share; });

    return out;

    function dist2(p, c) {
      var dL = (p.L - c.L) * LW, da = p.a - c.a, db = p.b - c.b;
      return dL * dL + da * da + db * db;
    }
  }

  /* =======================================================================
   * 3. 소재 추정 — 무늬의 결에서 읽는다
   *
   * 정확한 소재 분류기가 아니다. 색 변환 파라미터를 고르기 위한 **거친
   * 구분**이며, 틀려도 결과가 크게 망가지지 않도록 프로파일 간 차이를
   * 완만하게 잡았다. 사용자가 직접 고를 수 있게도 해 둔다.
   * ===================================================================== */
  function estimateMaterial(data, mask, w, h) {
    var Ls = [], gx = 0, gy = 0, n = 0, lap = 0;
    var Lbuf = new Float32Array(w * h);
    for (var p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      var i = p * 4;
      var L = CC.rgbToLab(data[i], data[i + 1], data[i + 2]).L;
      Lbuf[p] = L; Ls.push(L);
    }
    if (Ls.length < 50) return { key: 'cotton', conf: 0.2, why: '표본이 부족해 기본값(면)으로 둡니다.' };
    Ls.sort(function (a, b) { return a - b; });
    var p50 = Ls[Ls.length >> 1], p99 = Ls[Math.floor(Ls.length * .99)], p05 = Ls[Math.floor(Ls.length * .05)];

    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var q = y * w + x;
        if (!mask[q] || !mask[q - 1] || !mask[q + 1] || !mask[q - w] || !mask[q + w]) continue;
        var dx = Lbuf[q + 1] - Lbuf[q - 1], dy = Lbuf[q + w] - Lbuf[q - w];
        gx += Math.abs(dx); gy += Math.abs(dy);
        lap += Math.abs(4 * Lbuf[q] - Lbuf[q - 1] - Lbuf[q + 1] - Lbuf[q - w] - Lbuf[q + w]);
        n++;
      }
    }
    if (!n) return { key: 'cotton', conf: 0.2, why: '결을 읽을 영역이 부족합니다.' };
    var texture = lap / n;                    // 고주파 에너지 = 결의 거칠기
    var aniso = (gx - gy) / Math.max(1e-6, gx + gy); // +면 세로결(리브), -면 가로결
    var specRatio = (p99 - p50) / Math.max(1, p50);  // 하이라이트가 얼마나 튀는가
    var contrast = (p99 - p05);

    var key, why;
    if (specRatio > 0.55 && texture < 3.2) {
      key = 'silk'; why = '하이라이트가 크게 튀고 표면이 매끄럽습니다 — 광택 소재로 봅니다.';
    } else if (specRatio > 0.45 && texture < 5.0 && contrast > 30) {
      key = 'leather'; why = '강한 정반사에 결이 거의 없습니다 — 레더/코팅으로 봅니다.';
    } else if (texture > 9.0) {
      key = 'tweed'; why = '고주파 에너지가 매우 높습니다 — 트위드/부클레로 봅니다.';
    } else if (texture > 5.5 && aniso > 0.16) {
      key = 'knit'; why = '세로 방향 결이 뚜렷합니다 — 니트 리브로 봅니다.';
    } else if (texture > 5.0) {
      key = 'denim'; why = '대각 능직에 해당하는 결이 잡힙니다 — 데님/트윌로 봅니다.';
    } else if (texture > 3.0) {
      key = 'linen'; why = '가로세로 결이 고르게 잡힙니다 — 린넨/면으로 봅니다.';
    } else {
      key = 'jersey'; why = '결이 약하고 음영이 부드럽습니다 — 저지/면으로 봅니다.';
    }
    // 경계에 가까울수록 확신을 낮춘다
    var conf = clamp(0.45 + Math.abs(texture - 5.0) * 0.06 + Math.abs(specRatio - 0.5) * 0.4, 0.25, 0.85);
    return { key: key, conf: conf, why: why, texture: texture, aniso: aniso, specRatio: specRatio, contrast: contrast };
  }

  /* =======================================================================
   * 4. 색 변환 본체
   *
   * targetHex  로 바꿀 색
   * opts.cluster    바꿀 군집 인덱스 (없으면 가장 넓은 군집)
   * opts.mode       'single' 한 색만 | 'all' 무늬 전체를 같은 각도로 회전
   * opts.material   소재 키 (없으면 추정)
   * opts.strength   0~1, 원본과의 혼합비
   * ===================================================================== */
  function recolor(imageData, mask, w, h, targetHex, opts) {
    opts = opts || {};
    var d = imageData.data;
    var clusters = opts.clusters || clusterColors(d, mask, w, h, opts.k || 3);
    if (!clusters || !clusters.length) return { imageData: imageData, clusters: [], material: null };

    var mat = opts.material || estimateMaterial(d, mask, w, h).key;
    var P = PROFILES[mat] || PROFILES.cotton;
    var strength = opts.strength == null ? 1 : clamp(opts.strength, 0, 1);

    var ci = opts.cluster == null ? 0 : clamp(opts.cluster, 0, clusters.length - 1);
    var src = clusters[ci];
    var tLab = CC.hexToLab(targetHex);
    var tLch = CC.labToLch(tLab.L, tLab.a, tLab.b);
    var tC = Math.min(tLch.C, P.chromaCap);
    var tHrad = tLch.h * Math.PI / 180;
    var ta = tC * Math.cos(tHrad), tb = tC * Math.sin(tHrad);

    /* 무늬 전체를 돌릴 때는 각 군집을 **같은 각도만큼** 회전시킨다.
     * 전부 같은 색으로 칠하면 무늬가 사라지고, 아무것도 안 하면 원본이다. */
    var hueDelta = tLch.h - CC.labToLch(src.lab.L, src.lab.a, src.lab.b).h;
    var LDelta = tLab.L - src.p50;

    /* 조명(ambient) 바닥값. 곱셈 모델이 검정 옷에서 무너지지 않게 한다. */
    var AMB = 4.0;
    var srcRef = src.p50 + AMB;

    /* 밝기 양 끝은 자르지 않고 **눌러 담는다.**
     * 검은 가죽(L≈16)을 크림색(L≈91)으로 바꾸면 하이라이트가 갈 자리가
     * 9밖에 없다. 그대로 두면 위쪽이 L=100에 걸려 잘리고 광택이 납작한
     * 흰 덩어리가 된다. 무릎(knee) 위에서만 로그처럼 압축하면 계조가 남는다.
     *
     * 전체 감마를 낮추는 방법도 시도했지만 여유가 충분한 옷까지 납작해져
     * 폐기했다 — 문제는 범위 전체가 아니라 양 끝이다.
     *
     * 대비 자체가 줄어드는 것은 막을 수 없다. 밝은 천은 어두운 천보다
     * 절대 광량 변화가 작은 것이 물리적으로 옳다. 그래서 이 값을 숨기지 않고
     * "질감 보존"으로 화면에 그대로 보고한다. */
    /* 채도 곡선의 문턱을 **그 옷감의 실제 음영 분포**에 맞춘다.
     * 고정값(specAt)을 쓰면, 음영 폭이 넓은 옷감(가죽·새틴)에서는 평범한
     * 밝은 면까지 "하이라이트"로 분류돼 채도가 깎인다. 검은 라이더재킷을
     * 색만 바꿨을 때 옆구리에 창백한 띠가 생긴 것이 그 때문이었다.
     * 군집의 상·하위 10%를 기준으로 잡으면 옷감마다 알아서 맞는다. */
    var sHi = (src.p90 + AMB) / srcRef;
    var sLo = (src.p10 + AMB) / srcRef;
    var specAtEff = Math.max(P.specAt, sHi * 1.06);
    var shadeLo = Math.min(0.20, sLo * 0.82);
    var shadeHi = Math.max(shadeLo + 0.12, Math.min(0.72, sLo * 1.18 + 0.06));

    function softRange(L) {
      var HI = 86, LO = 8;
      if (L > HI) return HI + (100 - HI) * (1 - Math.exp(-(L - HI) / (100 - HI)));
      if (L < LO) return LO - LO * (1 - Math.exp(-(LO - L) / LO));
      return L;
    }

    /* 군집 소속을 딱딱하게 나누면 경계에 계단이 생긴다. 거리로 부드럽게 섞는다. */
    var SIGMA = opts.sigma || 16;

    var out = new ImageData(w, h);
    out.data.set(d);
    var od = out.data;

    for (var p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      var i = p * 4;
      var lab = CC.rgbToLab(d[i], d[i + 1], d[i + 2]);

      /* --- 어느 군집인가 (소프트) ---
       * 군집이 원래 갖고 있는 명도 폭(p10~p90) 안에 있으면 명도 차이를 0으로 본다.
       * 그렇게 하지 않으면 주름의 밝은 곳과 어두운 곳이 "덜 소속된" 것으로 처리돼
       * 색이 부분적으로만 먹고 옷이 얼룩덜룩해진다. */
      var wSum = 0, wSel = 0, bestI = 0, bestD = 1e9;
      for (var c = 0; c < clusters.length; c++) {
        var cl = clusters[c];
        var spread = Math.max(6, (cl.p90 - cl.p10) / 2 + 5);
        var dLraw = Math.max(0, Math.abs(lab.L - cl.p50) - spread);
        var dL = dLraw * LW, da = lab.a - cl.lab.a, db = lab.b - cl.lab.b;
        var dd = Math.sqrt(dL * dL + da * da + db * db);
        if (dd < bestD) { bestD = dd; bestI = c; }
        var ww = Math.exp(-(dd * dd) / (2 * SIGMA * SIGMA));
        wSum += ww;
        if (c === ci) wSel = ww;
      }
      var member = wSum > 1e-9 ? wSel / wSum : 0;

      var newLab;
      if (opts.mode === 'all') {
        /* 무늬 보존 회전 — 각 픽셀을 자기 군집 기준으로 옮긴다 */
        var base = clusters[bestI];
        var lch = CC.labToLch(lab.L, lab.a, lab.b);
        var nh = (lch.h + hueDelta) % 360; if (nh < 0) nh += 360;
        var nC = Math.min(lch.C * (base.achromatic ? 1 : (tC / Math.max(6, base.C))), P.chromaCap);
        if (base.achromatic) nC = lch.C;                    // 흰·검은 부분은 무채색으로 남긴다
        var nL = clamp(lab.L + LDelta * (base === src ? 1 : 0.45), 0, 100);
        newLab = CC.lchToLab(nL, nC, nh);
        member = 1;
      } else {
        if (member < 0.02) continue;

        /* --- 1) 음영 비율 --- */
        var s = (lab.L + AMB) / srcRef;
        s = clamp(s, 0.10, 2.6);
        var sg = Math.pow(s, P.gamma);
        var nL2 = clamp(softRange((tLab.L + AMB) * sg - AMB), 0, 100);

        /* --- 2) 채도 곡선 : 그늘과 하이라이트에서 채도를 뺀다 --- */
        var shadowMul = 1 - P.shadowDesat * (1 - smoothstep(shadeLo, shadeHi, s));
        var highMul = 1 - 0.80 * smoothstep(specAtEff, specAtEff + 0.55, s);
        var cMul = shadowMul * highMul;

        /* --- 3) 정반사 보존 : 하이라이트는 광원 색이지 옷 색이 아니다 ---
         * 이색성 반사 모델(dichromatic reflection): 보이는 빛 = 확산 + 정반사.
         * 정반사는 표면색과 무관하게 **더해지는** 성분이다.
         *
         * 예전에는 하이라이트를 원본 밝기 쪽으로 섞어서 보존했는데, 그러면
         * 검은 가죽재킷을 크림색으로 바꿀 때 하이라이트가 원본의 **어두운**
         * 값으로 끌려가 광택이 얼룩으로 보인다(질감 보존 0.38로 측정됐다).
         * 확산 성분(군집 상위 10%)을 넘어선 초과분만 떼어내 새 색 위에
         * 그대로 얹으면, 밝은 옷에서도 어두운 옷에서도 광택이 맞게 나온다. */
        var excess = Math.max(0, lab.L - src.p90);
        var specAdd = excess * P.specKeep;
        // 남은 밝기 여유 안에서만 얹는다. 검은 가죽처럼 원본의 정반사가
        // 확산 성분보다 훨씬 밝은 경우, 그대로 더하면 새 색 위에 흰 띠가
        // 타 버린다 — 크림색 라이더재킷에서 실제로 그렇게 나왔다.
        specAdd = Math.min(specAdd, (100 - Math.min(99, tLab.L)) * 0.72, 26);

        /* --- 4) 원본의 미세 색 흔들림(잔차) 유지 --- */
        var ra = (lab.a - src.lab.a) * P.residual;
        var rb = (lab.b - src.lab.b) * P.residual;

        var na = ta * cMul + ra;
        var nb2 = tb * cMul + rb;
        // 정반사는 광원 색(무채색)이므로 얹힌 만큼 채도를 뺀다
        var desat = clamp(specAdd / 42, 0, 0.60);
        nL2 = clamp(softRange(nL2 + specAdd), 0, 100);
        na *= (1 - desat); nb2 *= (1 - desat);

        newLab = { L: nL2, a: na, b: nb2 };
        newLab = gamutClip(newLab);
      }

      var rgb = CC.labToRgb(newLab.L, newLab.a, newLab.b);
      var mix = member * strength;
      od[i]     = clamp(d[i]     * (1 - mix) + rgb.r * mix, 0, 255);
      od[i + 1] = clamp(d[i + 1] * (1 - mix) + rgb.g * mix, 0, 255);
      od[i + 2] = clamp(d[i + 2] * (1 - mix) + rgb.b * mix, 0, 255);
    }

    return { imageData: out, clusters: clusters, material: mat, profile: P, target: tLab };
  }

  /**
   * 색역(gamut) 밖으로 나간 색을 채도를 낮춰 되돌린다.
   * 그냥 RGB에서 자르면 색상(hue)이 함께 돌아간다 — 빨강이 주황이 되는 식.
   * 채도만 줄이면 색상은 지켜진다.
   */
  function gamutClip(lab) {
    var lch = CC.labToLch(lab.L, lab.a, lab.b);
    var C = lch.C;
    for (var k = 0; k < 12; k++) {
      var t = CC.lchToLab(lab.L, C, lch.h);
      var rgb = CC.labToRgb(t.L, t.a, t.b);
      if (rgb.r >= -0.5 && rgb.r <= 255.5 && rgb.g >= -0.5 && rgb.g <= 255.5 &&
          rgb.b >= -0.5 && rgb.b <= 255.5) {
        return t;
      }
      C *= 0.88;
      if (C < 0.5) break;
    }
    return CC.lchToLab(lab.L, Math.max(0, C), lch.h);
  }

  /**
   * 변환이 실제로 얼마나 먹혔는지 되잰다.
   * "바꿔달라는 색"과 "실제로 나온 색"이 다를 수 있다 — 검은 가죽을
   * 노란색으로 바꾸면 재질상 그만큼 밝아지지 않는다. 그걸 숨기지 않고 보고한다.
   */
  function verify(before, after, mask, w, h, targetHex) {
    var bd = before.data, ad = after.data;
    var accB = { L: 0, a: 0, b: 0 }, accA = { L: 0, a: 0, b: 0 }, n = 0;
    var keepNum = 0, keepDen = 0;
    var step = Math.max(1, Math.floor(mask.length / 20000));
    for (var p = 0; p < mask.length; p += step) {
      if (!mask[p]) continue;
      var i = p * 4;
      var lb = CC.rgbToLab(bd[i], bd[i + 1], bd[i + 2]);
      var la = CC.rgbToLab(ad[i], ad[i + 1], ad[i + 2]);
      accB.L += lb.L; accB.a += lb.a; accB.b += lb.b;
      accA.L += la.L; accA.a += la.a; accA.b += la.b;
      n++;
    }
    if (!n) return null;
    var mb = { L: accB.L / n, a: accB.a / n, b: accB.b / n };
    var ma = { L: accA.L / n, a: accA.a / n, b: accA.b / n };

    /* 질감 보존율 — 명도 표준편차를 **평균 밝기로 나눈** 상대 대비의 비.
     * 절대 표준편차로 재면 밝은 옷을 어두운 색으로 바꿀 때 항상 낮게 나온다.
     * 어두운 천이 실제로 절대 광량 변화가 작은 것은 물리적으로 옳은 일이지,
     * 주름이 사라진 것이 아니다. 재고 싶은 것은 "결이 남았는가"이므로
     * 밝기에 무관한 상대량으로 재야 한다. */
    var sB = 0, sA = 0, n2 = 0;
    for (var q = 0; q < mask.length; q += step) {
      if (!mask[q]) continue;
      var j = q * 4;
      var vb = CC.rgbToLab(bd[j], bd[j + 1], bd[j + 2]).L - mb.L;
      var va = CC.rgbToLab(ad[j], ad[j + 1], ad[j + 2]).L - ma.L;
      sB += vb * vb; sA += va * va; n2++;
    }
    var sdB = Math.sqrt(sB / Math.max(1, n2)), sdA = Math.sqrt(sA / Math.max(1, n2));
    var relB = sdB / Math.max(6, mb.L + 4), relA = sdA / Math.max(6, ma.L + 4);

    var tgt = CC.hexToLab(targetHex);
    return {
      meanBefore: mb, meanAfter: ma,
      hitDeltaE: CC.deltaE2000(ma, tgt),       // 목표색과 실제 평균색의 거리
      movedDeltaE: CC.deltaE2000(mb, ma),      // 얼마나 움직였나
      textureKeep: relB > 1e-4 ? clamp(relA / relB, 0, 2) : 1,
      sdBefore: sdB, sdAfter: sdA,
      hexAfter: CC.labToHex(ma)
    };
  }

  global.RECOLOR = {
    PROFILES: PROFILES,
    clusterColors: clusterColors,
    estimateMaterial: estimateMaterial,
    recolor: recolor, gamutClip: gamutClip, verify: verify
  };
})(window);
