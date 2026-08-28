/* =========================================================================
 * segment.js — 인물 분리 (전신 사진에서 사람만 떼어내기)
 *
 * 기존 body.js 의 personMask 는 이렇게 동작한다.
 *   테두리에서 배경색 3개를 학습 → 그 색과 ΔE2000 이 15 넘으면 사람
 *
 * 단순하고 빠르지만 세 곳에서 무너진다.
 *
 *  1. **고정 임계 15.** 흰 셔츠를 입고 흰 벽 앞에 서면 옷과 벽의 색차가
 *     15에 못 미쳐 상의가 통째로 배경으로 빠진다. 그러면 몸통에 구멍이
 *     뚫린 채로 옷을 입히게 된다.
 *  2. **배경이 균일하다고 본다.** 실제 사진은 위아래로 밝기가 다르고
 *     (조명·비네팅) 그림자도 진다. 하나의 전역 모델로는 둘 다 못 맞춘다.
 *  3. **공간 정보를 안 쓴다.** 사람은 한 덩어리인데 픽셀마다 따로 판정해
 *     배경에 점이 남고 몸에 구멍이 남는다.
 *
 * 이 모듈은 같은 발상(테두리에서 배경을 배운다)을 유지하되 네 가지를 더한다.
 *
 *   · **행별 배경 모델** — 각 행의 좌우 끝에서 그 행의 배경색을 따로 잰다.
 *     세로 그라디언트가 있어도 맞는다.
 *   · **적응 임계(Otsu)** — 색차 분포를 두 무리로 가장 잘 가르는 값을
 *     그 사진에서 직접 찾는다. 고정값을 쓰지 않는다.
 *   · **연결성** — 가장 큰 덩어리만 남기고, 그 안의 구멍을 메운다.
 *     흰 셔츠가 배경으로 빠져도 머리·팔·바지가 그 둘레를 감싸고 있으면
 *     **구멍 메우기가 상의를 되살린다.** 1번 문제가 여기서 풀린다.
 *   · **합성 해상도에서 바로** — 640px 마스크를 늘려 쓰지 않으므로
 *     경계가 계단이 되지 않는다.
 *
 * 그리고 얼마나 잘 갈렸는지(분리도)를 함께 돌려준다. 잘 안 갈린 사진에서
 * 그럴듯한 결과를 내놓는 것보다 그 사실을 말하는 편이 낫다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var clamp = CC.clamp;

  /* Lab 유클리드 거리(ΔE76).
   * 배경 판정에는 ΔE2000 만큼 정교할 필요가 없고, 화소마다 네 번씩
   * 계산해야 해서 비용 차이가 크다. */
  function dE(l1, a1, b1, l2, a2, b2) {
    var dl = l1 - l2, da = a1 - a2, db = b1 - b2;
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  function median(arr) {
    if (!arr.length) return 0;
    arr.sort(function (a, b) { return a - b; });
    return arr[arr.length >> 1];
  }

  /* =======================================================================
   * Otsu — 색차 분포를 두 무리로 가장 잘 가르는 값
   *
   * 배경 픽셀은 0 근처에, 인물 픽셀은 멀리 몰린다. 그 사이 골짜기를 찾는다.
   * 두 무리가 잘 안 갈리면(옷과 배경이 비슷하면) 분리도가 낮게 나오고,
   * 그 값을 그대로 화면에 보고한다.
   * ===================================================================== */
  function otsu(dist, n, maxD, bins) {
    bins = bins || 128;
    var hist = new Float64Array(bins), total = 0;
    for (var i = 0; i < n; i++) {
      var b = Math.min(bins - 1, Math.floor(dist[i] / maxD * bins));
      hist[b]++; total++;
    }
    var sum = 0;
    for (var k = 0; k < bins; k++) sum += k * hist[k];
    var sumB = 0, wB = 0, best = -1, thrBin = 0, varTot = 0;
    var mean = sum / total;
    for (var k2 = 0; k2 < bins; k2++) varTot += hist[k2] * Math.pow(k2 - mean, 2);
    varTot /= total;
    for (var t = 0; t < bins; t++) {
      wB += hist[t]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF) / (total * total);
      if (between > best) { best = between; thrBin = t; }
    }
    return {
      thr: (thrBin + 0.5) / bins * maxD,
      separability: varTot > 1e-6 ? clamp(best / varTot, 0, 1) : 0
    };
  }

  /* =======================================================================
   * 형태학 · 연결성
   * ===================================================================== */
  function morph(src, w, h, mode, r) {
    var out = src;
    for (var it = 0; it < r; it++) {
      var next = new Uint8Array(w * h);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var p = y * w + x;
          var l = x > 0 ? out[p - 1] : out[p], rr = x < w - 1 ? out[p + 1] : out[p];
          var u = y > 0 ? out[p - w] : out[p], dn = y < h - 1 ? out[p + w] : out[p];
          next[p] = mode === 'dilate'
            ? (out[p] | l | rr | u | dn)
            : (out[p] & l & rr & u & dn);
        }
      }
      out = next;
    }
    return out;
  }

  /**
   * 일정 크기 이상의 덩어리를 모두 남긴다.
   *
   * 곧바로 "가장 큰 덩어리 하나"만 남기면 안 된다. 옷이 배경과 같은 색이라
   * 상의가 통째로 빠지면 인물이 머리·양팔·바지의 **여러 섬**으로 쪼개지는데,
   * 그때 하나만 남기면 나머지를 버리게 되고 구멍 메우기도 할 일이 없어진다.
   * 먼저 자잘한 잡티만 걷어내고, 구멍을 메워 섬들이 이어진 뒤에 하나로 고른다.
   */
  function dropSpecks(mask, w, h, minRatio) {
    var min = Math.max(24, Math.round(w * h * (minRatio || 0.003)));
    var seen = new Uint8Array(w * h), out = new Uint8Array(w * h), stack = [], comp = [];
    for (var s = 0; s < w * h; s++) {
      if (!mask[s] || seen[s]) continue;
      comp.length = 0; stack.length = 0; stack.push(s); seen[s] = 1;
      while (stack.length) {
        var p = stack.pop(); comp.push(p);
        var x = p % w, y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
        if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
      }
      if (comp.length >= min) for (var c = 0; c < comp.length; c++) out[comp[c]] = 1;
    }
    return out;
  }

  /** 가장 큰 덩어리만 남긴다 — 마지막 정리 단계에서만 쓴다 */
  function largestBlob(mask, w, h) {
    var lab = new Int32Array(w * h).fill(-1);
    var best = -1, bestSize = 0, stack = [];
    var id = 0;
    for (var s = 0; s < w * h; s++) {
      if (!mask[s] || lab[s] >= 0) continue;
      var size = 0; stack.length = 0; stack.push(s); lab[s] = id;
      while (stack.length) {
        var p = stack.pop(); size++;
        var x = p % w, y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack.push(p - 1); }
        if (x < w - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack.push(p + 1); }
        if (y > 0 && mask[p - w] && lab[p - w] < 0) { lab[p - w] = id; stack.push(p - w); }
        if (y < h - 1 && mask[p + w] && lab[p + w] < 0) { lab[p + w] = id; stack.push(p + w); }
      }
      if (size > bestSize) { bestSize = size; best = id; }
      id++;
    }
    if (best < 0) return { mask: mask, size: 0 };
    var out = new Uint8Array(w * h);
    for (var q = 0; q < w * h; q++) out[q] = lab[q] === best ? 1 : 0;
    return { mask: out, size: bestSize };
  }

  /**
   * 구멍 메우기 — 여기가 흰 셔츠 문제를 푸는 곳이다.
   *
   * 배경으로 판정된 픽셀 중 **이미지 테두리에서 닿을 수 없는** 것은
   * 사실 배경이 아니라 인물 안쪽의 구멍이다. 흰 셔츠가 벽과 같은 색이라
   * 배경으로 빠져도, 머리·팔·바지가 그 둘레를 감싸고 있으면 테두리와
   * 이어지지 않으므로 여기서 되살아난다.
   */
  function fillHoles(mask, w, h) {
    var outside = new Uint8Array(w * h), stack = [];
    function seed(x, y) {
      var p = y * w + x;
      if (!mask[p] && !outside[p]) { outside[p] = 1; stack.push(p); }
    }
    for (var x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (var y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
    while (stack.length) {
      var p = stack.pop(), px = p % w, py = (p / w) | 0;
      if (px > 0 && !mask[p - 1] && !outside[p - 1]) { outside[p - 1] = 1; stack.push(p - 1); }
      if (px < w - 1 && !mask[p + 1] && !outside[p + 1]) { outside[p + 1] = 1; stack.push(p + 1); }
      if (py > 0 && !mask[p - w] && !outside[p - w]) { outside[p - w] = 1; stack.push(p - w); }
      if (py < h - 1 && !mask[p + w] && !outside[p + w]) { outside[p + w] = 1; stack.push(p + w); }
    }
    var filled = 0, out = new Uint8Array(w * h);
    for (var q = 0; q < w * h; q++) {
      out[q] = (mask[q] || !outside[q]) ? 1 : 0;
      if (!mask[q] && !outside[q]) filled++;
    }
    return { mask: out, filled: filled };
  }

  /**
   * 세로 잇기 — 색으로는 도저히 안 갈리는 옷을 구조로 되살린다.
   *
   * 2차원 구멍 메우기는 상의가 **어깨 옆 틈**으로 배경과 이어져 있으면
   * 소용이 없다. 흰 셔츠·흰 벽에서 실제로 그랬다: 머리·양팔·바지는
   * 잡혔는데 상의만 빠졌고, 어깨 위 배경에서 그 자리로 물이 흘러들었다.
   *
   * 그런데 서 있는 사람은 **세로로 이어진 하나의 물체**다. 한 열에서
   * 위아래가 모두 사람이면 그 사이도 사람이다. 이 성질은 색과 무관하다.
   *
   * 무한정 이으면 벌어진 팔과 몸통 사이까지 메우므로, 몸 높이의 일정
   * 비율보다 짧은 틈만 잇는다.
   */
  function bridgeColumns(mask, w, h, maxGap) {
    /* 틈의 위아래가 **서로 다른 조각**일 때만 잇는다.
     *
     * 조건 없이 이었더니 이미 잘 갈린 사진에서 가랑이 노치가 조금 메워져
     * 정확도가 1.4% 떨어졌다. 이 단계의 목적은 "끊긴 인물을 다시 잇는 것"이지
     * 실루엣을 부풀리는 것이 아니다. 위아래가 이미 한 덩어리로 이어져
     * 있다면(가랑이·겨드랑이처럼 돌아서 만나면) 손대지 않는다. */
    var lab = labelComponents(mask, w, h);
    var out = new Uint8Array(mask.length);
    out.set(mask);
    var bridged = 0;
    for (var x = 0; x < w; x++) {
      var prev = -1;
      for (var y = 0; y < h; y++) {
        if (!mask[y * w + x]) continue;
        if (prev >= 0 && y - prev > 1 && y - prev <= maxGap &&
            lab[prev * w + x] !== lab[y * w + x]) {
          for (var k = prev + 1; k < y; k++) { out[k * w + x] = 1; bridged++; }
        }
        prev = y;
      }
    }
    return { mask: out, bridged: bridged };
  }

  /** 연결 성분 라벨 — 같은 덩어리인지 판정하는 데 쓴다 */
  function labelComponents(mask, w, h) {
    var lab = new Int32Array(w * h).fill(-1), stack = [], id = 0;
    for (var s = 0; s < w * h; s++) {
      if (!mask[s] || lab[s] >= 0) continue;
      stack.length = 0; stack.push(s); lab[s] = id;
      while (stack.length) {
        var p = stack.pop(), x = p % w, y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack.push(p - 1); }
        if (x < w - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack.push(p + 1); }
        if (y > 0 && mask[p - w] && lab[p - w] < 0) { lab[p - w] = id; stack.push(p - w); }
        if (y < h - 1 && mask[p + w] && lab[p + w] < 0) { lab[p + w] = id; stack.push(p + w); }
      }
      id++;
    }
    return lab;
  }

  /* =======================================================================
   * 본체
   * ===================================================================== */
  function person(img, w, h, opts) {
    opts = opts || {};
    var d = img.data, n = w * h;
    var issues = [];

    /* --- Lab 변환 (한 번만) --- */
    var La = new Float32Array(n), Aa = new Float32Array(n), Ba = new Float32Array(n);
    for (var i = 0, p = 0; p < n; p++, i += 4) {
      var lab = CC.rgbToLab(d[i], d[i + 1], d[i + 2]);
      La[p] = lab.L; Aa[p] = lab.a; Ba[p] = lab.b;
    }

    /* --- 행별 배경 모델 ---
     * 각 행의 좌우 끝에서 그 행의 배경색을 잰다. 세로로 밝기가 변하는
     * 사진(창문 쪽이 밝은 벽, 비네팅)에서도 맞는다. */
    var band = Math.max(3, Math.round(w * 0.06));
    var rl = new Float32Array(h), ra = new Float32Array(h), rb = new Float32Array(h);
    for (var y = 0; y < h; y++) {
      var Ls = [], As = [], Bs = [];
      for (var k = 0; k < band; k++) {
        var pL = y * w + k, pR = y * w + (w - 1 - k);
        Ls.push(La[pL], La[pR]); As.push(Aa[pL], Aa[pR]); Bs.push(Ba[pL], Ba[pR]);
      }
      rl[y] = median(Ls); ra[y] = median(As); rb[y] = median(Bs);
    }
    /* 세로 평활 — 인물의 팔이 가장자리에 닿은 행이 튀는 것을 막는다 */
    var vw = Math.max(2, Math.round(h * 0.02));
    rl = vmed(rl, h, vw); ra = vmed(ra, h, vw); rb = vmed(rb, h, vw);

    /* --- 전역 배경 클러스터 (보험) ---
     * 행별 모델이 인물에 오염된 행이 있어도 전역 모델이 받쳐 준다. */
    var samp = [];
    var sx = Math.max(1, Math.round(w / 60)), sy = Math.max(1, Math.round(h / 60));
    for (var x2 = 0; x2 < w; x2 += sx) {
      for (var t = 0; t < band; t++) {
        samp.push([La[t * w + x2], Aa[t * w + x2], Ba[t * w + x2]]);
      }
    }
    for (var y2 = 0; y2 < h; y2 += sy) {
      for (var t2 = 0; t2 < band; t2++) {
        samp.push([La[y2 * w + t2], Aa[y2 * w + t2], Ba[y2 * w + t2]]);
        samp.push([La[y2 * w + w - 1 - t2], Aa[y2 * w + w - 1 - t2], Ba[y2 * w + w - 1 - t2]]);
      }
    }
    var centers = kmeans3(samp, 3, 8);

    /* --- 색차 맵 --- */
    var MAXD = 60;
    var dist = new Float32Array(n);
    for (var yy = 0; yy < h; yy++) {
      var bl = rl[yy], ba = ra[yy], bb = rb[yy];
      for (var xx = 0; xx < w; xx++) {
        var q = yy * w + xx;
        var best = dE(La[q], Aa[q], Ba[q], bl, ba, bb);
        for (var c = 0; c < centers.length; c++) {
          var e = dE(La[q], Aa[q], Ba[q], centers[c][0], centers[c][1], centers[c][2]);
          if (e < best) best = e;
        }
        dist[q] = best > MAXD ? MAXD : best;
      }
    }

    /* --- 임계 : 배경이 스스로 얼마나 흔들리는가에서 정한다 ---
     *
     * 처음에는 Otsu(색차 분포를 두 무리로 가르는 값)를 썼다가 되레 나빠졌다.
     * 배경 픽셀이 압도적으로 많은 히스토그램에서 Otsu는 클래스간 분산을
     * 키우려고 임계를 높게 잡는다. 그 결과 흰옷·어두운옷처럼 배경과 가까운
     * 옷이 통째로 잘려 나갔다(IoU 0.33 → 0.11).
     *
     * 더 확실한 근거가 이미 있다 — **테두리는 배경이다.** 그 테두리 픽셀이
     * 자기 배경 모델에서 얼마나 벗어나는지가 곧 "배경의 흔들림"이고,
     * 그보다 더 벗어난 픽셀은 배경이 아니다. 조명 얼룩·벽 질감·노이즈가
     * 심한 사진에서는 자동으로 임계가 올라가고, 깨끗한 사진에서는 내려간다.
     *
     * 옷이 배경과 거의 같은 색이면(ΔE 2 수준) 색만으로는 어차피 못 가른다.
     * 그건 아래 구멍 메우기가 맡는다 — 머리·팔·바지가 둘레를 감싸므로. */
    var bd = [];
    for (var byy = 0; byy < h; byy += 2) {
      for (var bxx = 0; bxx < band; bxx += 2) {
        bd.push(dist[byy * w + bxx], dist[byy * w + (w - 1 - bxx)]);
      }
    }
    for (var bxx2 = 0; bxx2 < w; bxx2 += 2) {
      for (var byy2 = 0; byy2 < band; byy2 += 2) bd.push(dist[byy2 * w + bxx2]);
    }
    bd.sort(function (a, b) { return a - b; });
    var spread = bd.length ? bd[Math.min(bd.length - 1, Math.floor(bd.length * 0.985))] : 3;
    var thr = clamp(spread * 1.35, 2.2, 30);
    var o = otsu(dist, n, MAXD);   // 분리도 보고용 (임계 결정에는 쓰지 않는다)

    var raw = new Uint8Array(n);
    for (var m = 0; m < n; m++) raw[m] = dist[m] > thr ? 1 : 0;

    /* --- 정리 : 점 제거 → 최대 덩어리 → 구멍 메우기 → 닫기 --- */
    var cleaned = morph(morph(raw, w, h, 'erode', 1), w, h, 'dilate', 1);
    var kept = dropSpecks(cleaned, w, h, 0.003);   // 잡티만 제거 (섬은 남긴다)
    var h1 = fillHoles(kept, w, h);                // 섬들 사이의 구멍을 메운다
    /* 인물의 세로 범위를 먼저 알아야 "몸 높이 대비" 틈 길이를 정할 수 있다 */
    var pTop = 0, pBot = h - 1;
    while (pTop < h && !rowAny(h1.mask, w, pTop)) pTop++;
    while (pBot > pTop && !rowAny(h1.mask, w, pBot)) pBot--;
    var br = bridgeColumns(h1.mask, w, h, Math.max(8, (pBot - pTop) * 0.34));
    var h2 = fillHoles(br.mask, w, h);
    var big = largestBlob(h2.mask, w, h);          // 이어붙인 뒤에 하나로 고른다
    var h3 = fillHoles(big.mask, w, h);
    var mask = morph(morph(h3.mask, w, h, 'dilate', 1), w, h, 'erode', 1);
    var holes = { filled: h1.filled + h2.filled + h3.filled, bridged: br.bridged };

    var fg = 0;
    for (var f = 0; f < n; f++) if (mask[f]) fg++;

    /* --- 부드러운 알파 ---
     * 합성 해상도에서 바로 만든 마스크라 계단이 없다. 1px만 녹여
     * 옷 가장자리가 사진에 자연스럽게 앉게 한다. */
    var alpha = new Float32Array(n);
    for (var a0 = 0; a0 < n; a0++) alpha[a0] = mask[a0];
    alpha = box1(alpha, w, h);

    /* --- 품질 보고 --- */
    var fgRatio = fg / n;
    var holeRatio = holes.filled / Math.max(1, fg);
    if (o.separability < 0.35) {
      issues.push({ level: 'warn', ko: '옷과 배경의 색이 비슷해 인물을 깔끔히 분리하지 못했습니다(분리도 ' +
        (o.separability * 100).toFixed(0) + '%). 배경과 대비되는 옷을 입거나 단색 벽 앞에서 다시 찍으면 좋아집니다.' });
    }
    if (fgRatio < 0.05) {
      issues.push({ level: 'fatal', ko: '사진에서 사람을 찾지 못했습니다. 전신이 프레임 안에 들어오게 다시 찍어 주세요.' });
    } else if (fgRatio > 0.72) {
      issues.push({ level: 'warn', ko: '배경까지 사람으로 잡혔습니다. 인물과 배경의 색이 너무 비슷하거나 배경이 복잡합니다.' });
    }
    if (holeRatio > 0.12) {
      issues.push({ level: 'info', ko: '옷 일부가 배경과 같은 색이라 구멍이 났고, 둘레를 보고 메웠습니다(' +
        (holeRatio * 100).toFixed(0) + '%).' });
    }

    return {
      mask: mask, alpha: alpha, dist: dist,
      thr: thr, separability: o.separability,
      fgRatio: fgRatio, holeRatio: holeRatio, bridged: holes.bridged,
      ok: fgRatio >= 0.05 && fgRatio <= 0.80,
      issues: issues
    };
  }

  function rowAny(mask, w, y) {
    for (var x = 0; x < w; x++) if (mask[y * w + x]) return true;
    return false;
  }

  function vmed(arr, h, win) {
    var out = new Float32Array(h);
    for (var i = 0; i < h; i++) {
      var a = Math.max(0, i - win), b = Math.min(h - 1, i + win), s = [];
      for (var j = a; j <= b; j++) s.push(arr[j]);
      out[i] = median(s);
    }
    return out;
  }

  function box1(src, w, h) {
    var out = new Float32Array(src.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = y * w + x, sum = 0, cnt = 0;
        for (var dy = -1; dy <= 1; dy++) {
          var yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx; if (xx < 0 || xx >= w) continue;
            sum += src[yy * w + xx]; cnt++;
          }
        }
        out[p] = sum / cnt;
      }
    }
    return out;
  }

  function kmeans3(pts, k, iters) {
    if (pts.length <= k) return pts.slice();
    var c = [];
    for (var i = 0; i < k; i++) c.push(pts[Math.floor(pts.length * (i + 0.5) / k)].slice());
    for (var it = 0; it < iters; it++) {
      var acc = [];
      for (var a = 0; a < k; a++) acc.push([0, 0, 0, 0]);
      for (var j = 0; j < pts.length; j++) {
        var bi = 0, bd = 1e9;
        for (var m = 0; m < k; m++) {
          var dd = Math.pow(pts[j][0] - c[m][0], 2) + Math.pow(pts[j][1] - c[m][1], 2) +
                   Math.pow(pts[j][2] - c[m][2], 2);
          if (dd < bd) { bd = dd; bi = m; }
        }
        acc[bi][0] += pts[j][0]; acc[bi][1] += pts[j][1]; acc[bi][2] += pts[j][2]; acc[bi][3]++;
      }
      for (var q = 0; q < k; q++) {
        if (acc[q][3]) c[q] = [acc[q][0] / acc[q][3], acc[q][1] / acc[q][3], acc[q][2] / acc[q][3]];
      }
    }
    return c;
  }

  global.SEGMENT = {
    person: person, otsu: otsu, largestBlob: largestBlob, dropSpecks: dropSpecks,
    bridgeColumns: bridgeColumns, labelComponents: labelComponents,
    fillHoles: fillHoles, morph: morph
  };
})(window);
