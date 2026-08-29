/* =========================================================================
 * tryon.js — 가상 피팅 엔진 (옷 이미지를 실제 전신 사진에 입힌다)
 *
 * ── 원리 ────────────────────────────────────────────────────────────────
 * 상용 가상 피팅(VITON-HD, IDM-VTON 계열)은 네 단계로 되어 있다.
 *
 *   1. 사람 표현에서 옷을 지운다   (clothing-agnostic person representation)
 *   2. 옷을 몸에 맞게 변형한다     (TPS / appearance flow warping)
 *   3. 변형된 옷을 사람 위에 합성한다
 *   4. 경계와 질감을 생성 모델로 다듬는다 (GAN / diffusion)
 *
 * 이 파일은 1~3을 그대로 구현하고, 4는 **생성 모델 대신 물리적 근거로**
 * 대체한다. 4단계가 서버·GPU·가중치 수 GB를 요구하는 유일한 단계이며,
 * 그것을 넣는 순간 "사진이 브라우저 밖으로 나가지 않는다"는 이 도구의
 * 첫 번째 약속이 깨지기 때문이다.
 *
 * 생성 모델 없이 합성이 "붙여넣기"로 보이지 않게 하는 것은 결국 빛이다.
 * 그래서 사진에서 **조명장(lighting field)** 을 뽑아 옷에 다시 씌운다.
 * 왼쪽에서 빛이 든 사진이면 옷의 왼쪽도 밝아야 한다. 이 한 가지가
 * 없고 있고의 차이가 가장 크다.
 *
 * ── 정직한 한계 ─────────────────────────────────────────────────────────
 * · 정면 사진 한 장에서 몸의 3D 형태를 알 수 없다. 옷은 실루엣 폭에
 *   맞춰 2D로 변형될 뿐이며, 몸의 앞뒤 두께는 반영되지 않는다.
 * · 원래 입고 있던 옷이 새 옷보다 크면(긴팔 → 반팔) 드러나는 부분을
 *   **복원할 수 없다.** 주변 색으로 메우며, 그 사실을 화면에 표시한다.
 * · 팔짱·주머니에 넣은 손 등 복잡한 가림은 처리하지 못한다.
 * 이 도구는 "이 색과 이 실루엣이 나에게 어떻게 보이는가"를 위한 것이지
 * 상품 상세컷을 만들기 위한 것이 아니다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var clamp = CC.clamp;

  /* =======================================================================
   * 1. Thin-Plate Spline
   *
   * 대응점 몇 개만 주면 그 사이를 "휘어짐 에너지가 최소가 되도록" 매끈하게
   * 이어주는 보간법. 옷 변형에 쓰는 고전적인 방법이며, 어깨·소매·밑단만
   * 지정해도 그 사이의 천이 자연스럽게 따라온다.
   *
   * 목적지(사진) → 원본(옷) 방향으로 푼다. 출력 픽셀마다 "이 자리에
   * 올 옷의 어느 점인가"를 물어야 구멍 없이 채울 수 있기 때문이다.
   * ===================================================================== */
  function solveTPS(dst, src, lambda) {
    /* 거의 겹치는 대응점은 버린다.
     * 두 점이 붙어 있으면 K의 두 행이 사실상 같아져 선형계가 특이해지고,
     * 해가 폭주한다. 목선과 어깨선처럼 3px 차이로 나란히 놓이는 지점이
     * 실제로 있어서 이 정리가 필요하다. */
    var fd = [], fs = [], di, dj, keep;
    var spanX = 0, spanY = 0, k0;
    for (k0 = 0; k0 < dst.length; k0++) {
      spanX = Math.max(spanX, Math.abs(dst[k0][0] - dst[0][0]));
      spanY = Math.max(spanY, Math.abs(dst[k0][1] - dst[0][1]));
    }
    var minGap = Math.max(2, (spanX + spanY) * 0.02);
    for (di = 0; di < dst.length; di++) {
      keep = true;
      for (dj = 0; dj < fd.length; dj++) {
        if (Math.abs(fd[dj][0] - dst[di][0]) < minGap &&
            Math.abs(fd[dj][1] - dst[di][1]) < minGap) { keep = false; break; }
      }
      if (keep) { fd.push(dst[di]); fs.push(src[di]); }
    }
    dst = fd; src = fs;

    var n = dst.length, m = n + 3;
    if (n < 3) return null;

    /* ── 좌표 정규화 : 이걸 빼면 조용히 망가진다 ──────────────────────────
     * 커널 U(r)=r²·ln(r²) 은 좌표 크기에 매우 민감하다. 픽셀 좌표(수백)를
     * 그대로 넣으면 K 성분이 1e6 규모인데 P 성분은 1 이라, 선형계의 조건수가
     * 폭발해 해가 진동한다. 겉으로는 오류가 나지 않고 **옷만 이상하게 접힌다.**
     * 실측에서 몸통 중심선의 매핑이 38 표본 중 21번 뒤집혔고 픽셀의 절반이
     * 옷 바깥으로 날아갔다 — 원인이 이것이었다.
     * 무게중심을 원점으로 옮기고 평균 반경으로 나눈 뒤 푼다. */
    var cx = 0, cy = 0, i;
    for (i = 0; i < n; i++) { cx += dst[i][0]; cy += dst[i][1]; }
    cx /= n; cy /= n;
    var scale = 0;
    for (i = 0; i < n; i++) {
      scale += Math.sqrt(Math.pow(dst[i][0] - cx, 2) + Math.pow(dst[i][1] - cy, 2));
    }
    scale = (scale / n) || 1;
    var P = [];
    for (i = 0; i < n; i++) P.push([(dst[i][0] - cx) / scale, (dst[i][1] - cy) / scale]);

    var A = [], bx = new Float64Array(m), by = new Float64Array(m);
    for (i = 0; i < m; i++) A.push(new Float64Array(m));

    var meanK = 0, cnt = 0;
    for (var i1 = 0; i1 < n; i1++) {
      for (var j = 0; j < n; j++) {
        var u = U(dist(P[i1], P[j]));
        A[i1][j] = u;
        if (i1 !== j) { meanK += Math.abs(u); cnt++; }
      }
    }
    var reg = (lambda == null ? 8e-4 : lambda) * (cnt ? meanK / cnt : 1);
    for (var i2 = 0; i2 < n; i2++) {
      A[i2][i2] += reg;
      A[i2][n] = 1; A[i2][n + 1] = P[i2][0]; A[i2][n + 2] = P[i2][1];
      A[n][i2] = 1; A[n + 1][i2] = P[i2][0]; A[n + 2][i2] = P[i2][1];
      bx[i2] = src[i2][0]; by[i2] = src[i2][1];
    }
    /* gauss()는 A를 파괴적으로 소거한다. 그래서 **먼저** 복사본을 떠 둔다.
     * 예전에는 `gauss(A, bx), gauss(cloneMat(A), by)` 순으로 썼는데,
     * 자바스크립트는 왼쪽부터 평가하므로 두 번째 clone이 이미 소거된 A를
     * 복사했다. x 매핑은 멀쩡한데 y 매핑만 조용히 쓰레기가 되는 버그였고,
     * 옷이 접히고 구멍이 뚫린 진짜 원인이 이것이었다. */
    var A2 = cloneMat(A, m);
    var wx = gauss(A, bx, m);
    var wy = gauss(A2, by, m);
    if (!wx || !wy) return null;

    return function (x, y) {
      var nx = (x - cx) / scale, ny = (y - cy) / scale;
      var sx = wx[n] + wx[n + 1] * nx + wx[n + 2] * ny;
      var sy = wy[n] + wy[n + 1] * nx + wy[n + 2] * ny;
      for (var k = 0; k < n; k++) {
        var dx = nx - P[k][0], dy = ny - P[k][1];
        var u = U(Math.sqrt(dx * dx + dy * dy));
        sx += wx[k] * u; sy += wy[k] * u;
      }
      return [sx, sy];
    };

    function U(r) { return r < 1e-9 ? 0 : r * r * Math.log(r * r); }
    function dist(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }
  }

  function cloneMat(A, m) {
    var B = [];
    for (var i = 0; i < m; i++) B.push(Float64Array.from(A[i]));
    return B;
  }

  /** 부분 피벗 가우스 소거 */
  function gauss(A, b, m) {
    var x = Float64Array.from(b);
    for (var c = 0; c < m; c++) {
      var piv = c, mx = Math.abs(A[c][c]);
      for (var r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > mx) { mx = Math.abs(A[r][c]); piv = r; }
      if (mx < 1e-12) return null;
      if (piv !== c) { var t = A[c]; A[c] = A[piv]; A[piv] = t; var tv = x[c]; x[c] = x[piv]; x[piv] = tv; }
      for (var r2 = c + 1; r2 < m; r2++) {
        var f = A[r2][c] / A[c][c]; if (!f) continue;
        for (var k = c; k < m; k++) A[r2][k] -= f * A[c][k];
        x[r2] -= f * x[c];
      }
    }
    for (var i = m - 1; i >= 0; i--) {
      var s = x[i];
      for (var j = i + 1; j < m; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }

  /** TPS를 격자에서만 풀고 사이를 선형보간 — 픽셀마다 풀면 10배 느리다 */
  function warpField(fn, x0, y0, x1, y1, step) {
    var gw = Math.ceil((x1 - x0) / step) + 2, gh = Math.ceil((y1 - y0) / step) + 2;
    var gx = new Float32Array(gw * gh), gy = new Float32Array(gw * gh);
    for (var j = 0; j < gh; j++) {
      for (var i = 0; i < gw; i++) {
        var p = fn(x0 + i * step, y0 + j * step);
        gx[j * gw + i] = p[0]; gy[j * gw + i] = p[1];
      }
    }
    return function (x, y, out) {
      var fx = (x - x0) / step, fy = (y - y0) / step;
      var ix = fx | 0, iy = fy | 0;
      if (ix < 0) ix = 0; if (iy < 0) iy = 0;
      if (ix > gw - 2) ix = gw - 2; if (iy > gh - 2) iy = gh - 2;
      var tx = fx - ix, ty = fy - iy, o = iy * gw + ix;
      var a = gx[o], b = gx[o + 1], c = gx[o + gw], d = gx[o + gw + 1];
      out[0] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      a = gy[o]; b = gy[o + 1]; c = gy[o + gw]; d = gy[o + gw + 1];
      out[1] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
  }

  /* =======================================================================
   * 2. 유틸 — 블러 · 샘플링 · 최근접 채우기
   * ===================================================================== */
  function boxBlur(src, w, h, r, passes) {
    var a = Float32Array.from(src), b = new Float32Array(src.length);
    passes = passes || 3;
    for (var p = 0; p < passes; p++) {
      for (var y = 0; y < h; y++) {
        var acc = 0, row = y * w;
        for (var i = -r; i <= r; i++) acc += a[row + clamp(i, 0, w - 1)];
        for (var x = 0; x < w; x++) {
          b[row + x] = acc / (2 * r + 1);
          acc += a[row + clamp(x + r + 1, 0, w - 1)] - a[row + clamp(x - r, 0, w - 1)];
        }
      }
      for (var x2 = 0; x2 < w; x2++) {
        var acc2 = 0;
        for (var i2 = -r; i2 <= r; i2++) acc2 += b[clamp(i2, 0, h - 1) * w + x2];
        for (var y2 = 0; y2 < h; y2++) {
          a[y2 * w + x2] = acc2 / (2 * r + 1);
          acc2 += b[clamp(y2 + r + 1, 0, h - 1) * w + x2] - b[clamp(y2 - r, 0, h - 1) * w + x2];
        }
      }
    }
    return a;
  }

  function sampleRGBA(d, w, h, x, y, out) {
    if (x < 0 || y < 0 || x > w - 1 || y > h - 1) { out[3] = 0; return false; }
    var x0 = x | 0, y0 = y | 0;
    var x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    var tx = x - x0, ty = y - y0;
    var i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4,
        i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
    for (var c = 0; c < 4; c++) {
      out[c] = (d[i00 + c] * (1 - tx) + d[i10 + c] * tx) * (1 - ty) +
               (d[i01 + c] * (1 - tx) + d[i11 + c] * tx) * ty;
    }
    return true;
  }

  /**
   * 최근접 알려진 픽셀로 채우기 (2-pass 체임퍼 거리변환).
   * 원래 옷이 새 옷보다 커서 드러난 영역을 메운다. 생성이 아니라 확산이므로
   * 정보를 만들어내지 않는다 — 그래서 넓게 드러날수록 티가 나고,
   * 그 면적을 그대로 사용자에게 보고한다.
   */
  function nearestFill(d, w, h, known, region) {
    // 주의: known 은 **확산의 출처**다. 여기에 배경이 섞이면 배경색이 몸 안으로
    // 번진다(다리가 허옇게 뜨는 현상). 호출부에서 인물 안쪽만 넘겨야 한다.
    var INF = 1e9;
    var dist = new Float32Array(w * h), srcI = new Int32Array(w * h);
    for (var i = 0; i < w * h; i++) {
      if (known[i]) { dist[i] = 0; srcI[i] = i; } else { dist[i] = INF; srcI[i] = -1; }
    }
    function rel(p, q, cost) {
      if (srcI[q] < 0) return;
      var nd = dist[q] + cost;
      if (nd < dist[p]) { dist[p] = nd; srcI[p] = srcI[q]; }
    }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = y * w + x;
      if (x > 0) rel(p, p - 1, 1);
      if (y > 0) rel(p, p - w, 1);
      if (x > 0 && y > 0) rel(p, p - w - 1, 1.414);
      if (x < w - 1 && y > 0) rel(p, p - w + 1, 1.414);
    }
    for (var y2 = h - 1; y2 >= 0; y2--) for (var x2 = w - 1; x2 >= 0; x2--) {
      var q2 = y2 * w + x2;
      if (x2 < w - 1) rel(q2, q2 + 1, 1);
      if (y2 < h - 1) rel(q2, q2 + w, 1);
      if (x2 < w - 1 && y2 < h - 1) rel(q2, q2 + w + 1, 1.414);
      if (x2 > 0 && y2 < h - 1) rel(q2, q2 + w - 1, 1.414);
    }
    for (var k = 0; k < w * h; k++) {
      if (!region[k] || srcI[k] < 0) continue;
      var a = k * 4, b = srcI[k] * 4;
      d[a] = d[b]; d[a + 1] = d[b + 1]; d[a + 2] = d[b + 2];
    }
    // 보로노이 경계의 각진 선을 지운다
    smoothRegion(d, w, h, region, 2);
  }

  function smoothRegion(d, w, h, region, r) {
    var ch = [0, 1, 2];
    var tmp = new Float32Array(w * h);
    for (var c = 0; c < 3; c++) {
      for (var i = 0; i < w * h; i++) tmp[i] = d[i * 4 + ch[c]];
      var bl = boxBlur(tmp, w, h, r, 2);
      for (var j = 0; j < w * h; j++) if (region[j]) d[j * 4 + ch[c]] = bl[j];
    }
  }

  function dilate(mask, w, h, r) {
    var out = mask;
    for (var it = 0; it < r; it++) {
      var next = new Uint8Array(w * h);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var p = y * w + x;
        if (out[p] || (x > 0 && out[p - 1]) || (x < w - 1 && out[p + 1]) ||
            (y > 0 && out[p - w]) || (y < h - 1 && out[p + w])) next[p] = 1;
      }
      out = next;
    }
    return out;
  }

  /* =======================================================================
   * 3. 몸 준비 — 전신 분석 결과를 피팅용 좌표계로 바꾼다
   *
   * body.js는 체형 판정을 위해 640px로 줄여 분석한다. 피팅은 눈으로 보는
   * 결과물이라 그 해상도로는 거칠다. 그래서 원본에서 다시 크게 그리고,
   * 마스크와 랜드마크만 배율만큼 늘려 쓴다.
   * ===================================================================== */
  function prepare(bodyRes, source, targetH) {
    if (!bodyRes || !bodyRes.ok) return null;
    var sw = bodyRes.work.w, sh = bodyRes.work.h;
    targetH = Math.min(targetH || 900, Math.max(sh, 900));
    var scale = targetH / sh;
    var w = Math.round(sw * scale), h = Math.round(sh * scale);

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source && source.width ? source : bodyRes.work.canvas, 0, 0, w, h);

    /* ── 인물 분리 ──
     * 640px 마스크를 늘려 쓰지 않고 **합성할 해상도에서 직접** 다시 나눈다.
     * 늘려 쓰면 (1) 경계가 계단이 되고 (2) 640px에서 놓친 구멍을 그대로
     * 물려받는다. segment.js 는 행별 배경 모델 + 적응 임계 + 연결성으로
     * 나누고, 인물 안쪽의 구멍을 메워 준다 — 흰 셔츠가 흰 벽과 같은 색이라
     * 배경으로 빠져도 되살아난다.
     * 실패하면 body.js 의 마스크를 늘려 쓰는 예전 방식으로 되돌린다. */
    var img0 = ctx.getImageData(0, 0, w, h);
    var seg = null;
    try { seg = SEGMENT.person(img0, w, h); } catch (e) { seg = null; }

    var mask, edge, segInfo = null;
    if (seg && seg.ok) {
      mask = seg.mask;
      edge = seg.alpha;
      segInfo = {
        from: 'segment', separability: seg.separability, thr: seg.thr,
        fgRatio: seg.fgRatio, holeRatio: seg.holeRatio, issues: seg.issues
      };
    } else {
      mask = new Uint8Array(w * h);
      edge = new Float32Array(w * h);
      for (var y = 0; y < h; y++) {
        var fy = clamp(y / scale - 0.5, 0, sh - 1);
        var y0 = fy | 0, y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
        for (var x = 0; x < w; x++) {
          var fx = clamp(x / scale - 0.5, 0, sw - 1);
          var x0 = fx | 0, x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
          var m00 = bodyRes.mask[y0 * sw + x0], m10 = bodyRes.mask[y0 * sw + x1];
          var m01 = bodyRes.mask[y1 * sw + x0], m11 = bodyRes.mask[y1 * sw + x1];
          var v = (m00 * (1 - tx) + m10 * tx) * (1 - ty) + (m01 * (1 - tx) + m11 * tx) * ty;
          var p0 = y * w + x;
          mask[p0] = v >= 0.5 ? 1 : 0;
          edge[p0] = v <= 0.22 ? 0 : v >= 0.72 ? 1 : (v - 0.22) / 0.50;
        }
      }
      mask = DETECT.morph(DETECT.morph(mask, w, h, 'dilate', 1), w, h, 'erode', 1);
      segInfo = {
        from: 'body.js(대체)',
        issues: [{ level: 'warn', ko: '인물 분리에 실패해 낮은 해상도의 예전 마스크를 썼습니다. 경계가 거칠 수 있습니다.' }]
      };
    }

    var img = img0;
    var skin = DETECT.skinMask(img, w, h).mask;

    /* ── 행별 스팬 ──────────────────────────────────────────────────
     * 세 가지를 따로 둔다.
     *   x0/x1   : 실루엣 전체(팔·손 포함)
     *   cx0/cx1 : 가장 긴 전경 구간 — 팔이 몸에서 떨어져 있을 때의 몸통
     *   tx0/tx1 : 가장 긴 **옷 구간**(전경이면서 피부가 아닌 곳)
     *
     * tx 가 필요해진 이유가 있다. 인물 분리를 고치자 팔이 몸통과 한 덩어리로
     * 잡히기 시작했고, 그러자 "가장 긴 구간"이 팔까지 삼켰다. 그 폭으로
     * 바지 허리를 재니 청바지가 **팔뚝에까지** 칠해졌다.
     * 반팔이면 팔은 맨살이고 몸통은 옷이므로, 피부를 뺀 최장 구간이 곧
     * 몸통이다. 긴팔이면 팔도 옷이라 함께 잡히는데 그때는 소매가 팔을
     * 덮는 것이 맞다. 옷이 안 보이는 행(맨살 다리, 반바지 아래)에서는
     * 구간이 짧아지므로 cx 로 되돌린다. */
    var rows = [];
    for (var y2 = 0; y2 < h; y2++) {
      var a = -1, b = -1, run = -1, bestRun = 0, bx0 = -1, bx1 = -1;
      var trun = -1, tBest = 0, tx0 = -1, tx1 = -1;
      for (var x2 = 0; x2 < w; x2++) {
        var q2 = y2 * w + x2;
        if (mask[q2]) {
          if (a < 0) a = x2; b = x2;
          if (run < 0) run = x2;
          if (!skin[q2]) { if (trun < 0) trun = x2; }
          else if (trun >= 0) {
            if (x2 - trun > tBest) { tBest = x2 - trun; tx0 = trun; tx1 = x2 - 1; }
            trun = -1;
          }
        } else {
          if (run >= 0) {
            if (x2 - run > bestRun) { bestRun = x2 - run; bx0 = run; bx1 = x2 - 1; }
            run = -1;
          }
          if (trun >= 0) {
            if (x2 - trun > tBest) { tBest = x2 - trun; tx0 = trun; tx1 = x2 - 1; }
            trun = -1;
          }
        }
      }
      if (run >= 0 && w - run > bestRun) { bestRun = w - run; bx0 = run; bx1 = w - 1; }
      if (trun >= 0 && w - trun > tBest) { tBest = w - trun; tx0 = trun; tx1 = w - 1; }
      // 옷 구간이 몸통 구간의 40%도 안 되면 옷을 못 찾은 것이다
      if (!(tBest >= (bestRun || 1) * 0.40)) { tx0 = -1; tx1 = -1; }
      rows.push({ x0: a, x1: b, cx0: bx0, cx1: bx1, tx0: tx0, tx1: tx1 });
    }

    /* ── 랜드마크 ──
     * 실루엣에서 직접 잡은 값을 우선한다. body.js 의 값은 얼굴 검출에
     * 의존해 반팔 사진에서 크게 빗나가기 때문이다(위 silhouetteLM 참고).
     * 실루엣 판독이 실패하면 기존 값으로 되돌린다. */
    var L = bodyRes.landmarks, lm = {}, lmSource = 'body.js';
    ['top', 'bottom', 'headTop', 'chinY', 'headH', 'bodyH'].forEach(function (k) {
      lm[k] = Math.round(L[k] * scale);
    });
    ['shoulder', 'bust', 'waist', 'hip'].forEach(function (k) {
      lm[k] = { y: Math.round(L[k].y * scale), w: L[k].w * scale };
    });

    var sil = null;
    try { sil = silhouetteLM(rows, mask, skin, w, h); } catch (e) { sil = null; }
    if (sil) {
      sil.headTop = sil.top;
      lm = sil;
      lmSource = 'silhouette';
    }
    // 인물 분리가 부실하면(전경 비율이 비정상) 어느 쪽 값도 믿기 어렵다
    if (bodyRes.fgRatio != null && (bodyRes.fgRatio < 0.04 || bodyRes.fgRatio > 0.75)) {
      lmSource += '(전경 비율 이상)';
    }

    /* 조명장 — 사진의 빛이 어느 쪽에서 오는가 */
    var d = img.data;
    var lum = new Float32Array(w * h);
    for (var p = 0, i = 0; p < w * h; p++, i += 4) {
      lum[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    }
    var lr = Math.max(6, Math.round(Math.min(w, h) * 0.06));
    var light = boxBlur(lum, w, h, lr, 3);

    /* 피부색 기준 — 드러난 부분을 메울 때 쓴다 */
    var skinLab = sampleSkin(d, skin, mask, w, h, lm);

    return {
      canvas: cv, ctx: ctx, w: w, h: h, image: img,
      mask: mask, edge: edge, seg: segInfo,
      skin: skin, rows: rows, lm: lm, lmSource: lmSource, light: light,
      scale: scale, skinLab: skinLab, source: bodyRes
    };
  }

  function sampleSkin(d, skin, mask, w, h, lm) {
    var acc = { L: 0, a: 0, b: 0 }, n = 0;
    var y0 = Math.max(0, lm.headTop), y1 = Math.min(h - 1, lm.chinY);
    for (var y = y0; y <= y1; y++) {
      for (var x = 0; x < w; x += 2) {
        var p = y * w + x;
        if (!skin[p] || !mask[p]) continue;
        var i = p * 4;
        var lab = CC.rgbToLab(d[i], d[i + 1], d[i + 2]);
        acc.L += lab.L; acc.a += lab.a; acc.b += lab.b; n++;
      }
    }
    if (!n) return { L: 68, a: 12, b: 18 };
    return { L: acc.L / n, a: acc.a / n, b: acc.b / n };
  }

  /* =======================================================================
   * 4. 몸의 착의 앵커 — 옷의 어느 점이 몸의 어디에 가야 하는가
   * ===================================================================== */
  function spanAt(body, y, core) {
    var h = body.h, r = clamp(Math.round(y), 0, h - 1);
    var win = Math.max(1, Math.round(body.h * 0.006));
    var a = [], b = [];
    for (var k = -win; k <= win; k++) {
      var rr = body.rows[clamp(r + k, 0, h - 1)];
      /* 몸통을 물으면 **옷 구간**을 먼저 준다(rows 주석 참고).
       * 팔이 몸통에 붙어 보여도 몸통 폭이 팔만큼 부풀지 않는다. */
      var x0 = core ? (rr.tx0 >= 0 ? rr.tx0 : rr.cx0) : rr.x0;
      var x1 = core ? (rr.tx0 >= 0 ? rr.tx1 : rr.cx1) : rr.x1;
      if (x0 >= 0) { a.push(x0); b.push(x1); }
    }
    if (!a.length) {
      var cw = body.lm.shoulder.w || body.w * 0.2;
      return { x0: body.w / 2 - cw / 2, x1: body.w / 2 + cw / 2, cx: body.w / 2, w: cw };
    }
    a.sort(function (p, q) { return p - q; }); b.sort(function (p, q) { return p - q; });
    var x0m = a[a.length >> 1], x1m = b[b.length >> 1];
    return { x0: x0m, x1: x1m, cx: (x0m + x1m) / 2, w: x1m - x0m };
  }

  /* ── 몸 쪽 해부학 사다리 ────────────────────────────────────────────
   * garments.js의 HEM_Y / HEM_Y_B / 소매 위치와 **같은 지점**을 가리켜야 한다.
   * 두 표가 어긋나면 TPS가 옷의 한 구간을 몸의 다른 길이로 늘여 소매가 접힌다.
   * 그래서 두 표를 나란히 두고, 바꿀 때는 반드시 함께 바꾼다.
   * ------------------------------------------------------------------ */
  var HEM_BODY = {
    crop:  function (L) { return L.shoulder.y + (L.waist.y - L.shoulder.y) * 0.72; },
    waist: function (L) { return L.waist.y + (L.hip.y - L.waist.y) * 0.10; },
    hip:   function (L) { return L.hip.y + (L.bottom - L.hip.y) * 0.06; },
    thigh: function (L) { return L.hip.y + (L.bottom - L.hip.y) * 0.26; },
    knee:  function (L) { return L.hip.y + (L.bottom - L.hip.y) * 0.52; },
    midi:  function (L) { return L.hip.y + (L.bottom - L.hip.y) * 0.74; },
    ankle: function (L) { return L.bottom - (L.bottom - L.hip.y) * 0.04; }
  };

  /** 소매 끝 — 팔꿈치는 허리 높이, 손목은 골반 아래 28% 지점 */
  function elbowY(L) { return L.waist.y; }
  function wristY(L) { return L.hip.y + (L.bottom - L.hip.y) * 0.28; }

  /* ── 소매 길이는 **팔 길이의 비율**로 잡는다 ──────────────────────────
   * 예전에는 옷본의 소맷부리 높이를 어깨~밑단에 선형 대응시켜 옮겼다.
   * 그러면 밑단이 조금만 어긋나도 소매가 통째로 밀린다 — 밑단이 50px
   * 내려가자 반팔 소맷부리가 팔꿈치 아래까지 내려갔다.
   *
   * 소매 길이는 옷의 기장이 아니라 **팔**이 정하는 값이다. 어깨에서
   * 손목까지를 1로 놓으면 사람마다 거의 같은 비율에 떨어진다.
   *   캡 0.12 · 반팔 0.28(위팔 중간쯤) · 7부 0.75 · 긴팔 1.0
   * 위팔(어깨~팔꿈치)이 팔 전체의 약 0.48이므로 반팔 0.28은 위팔의 60%
   * 지점 — 실제 반팔이 끝나는 곳이다. */
  var SLEEVE_FRAC = { none: 0.12, cap: 0.12, short: 0.28, threeq: 0.75, long: 1.0 };
  var SLEEVE_BODY = {
    none:   function (L) { return L.shoulder.y + (L.waist.y - L.shoulder.y) * 0.30; },
    cap:    function (L) { return L.shoulder.y + (L.waist.y - L.shoulder.y) * 0.30; },
    short:  function (L) { return L.shoulder.y + (L.waist.y - L.shoulder.y) * 0.62; },
    threeq: function (L) { return elbowY(L) + (wristY(L) - elbowY(L)) * 0.70; },
    long:   function (L) { return wristY(L); }
  };

  /**
   * 팔이 어디까지 있는가.
   * 소매 끝을 해부학 비율로만 잡으면, 팔이 짧게 나온 사진이나 손을 주머니에
   * 넣은 사진에서 **팔이 없는 자리**에 소매 대응점을 찍게 된다. 그러면 그
   * 지점의 실루엣(다리·몸통)이 소매로 끌려온다.
   * 실루엣 전체 폭이 몸통 폭보다 뚜렷하게 넓은 구간이 팔이다.
   */
  function armInfo(body) {
    if (body._arm) return body._arm;
    var L = body._lmSane || (body._lmSane = saneLM(body.lm));
    var w = body.w, h = body.h, gap = Math.max(2, w * 0.014);
    var lastL = -1, lastR = -1, sep = false;
    /* 가랑이 아래는 보지 않는다. 두 다리가 있는 행은 실루엣이 두 조각이라
     * "팔이 몸에서 떨어져 있다"는 신호와 구별되지 않는다 — 그 탓에 팔이
     * 발목까지 이어진 것으로 읽혀 반팔 소매가 종아리까지 내려갔다. */
    var scanTo = Math.min(h, L.crotchY > 0 ? L.crotchY - h * 0.005
                                             : L.hip.y + (L.bottom - L.hip.y) * 0.42);
    for (var y = Math.max(0, L.shoulder.y); y < scanTo; y++) {
      var r = body.rows[y];
      if (!r || r.cx0 < 0) continue;
      /* 팔이 몸에서 떨어져 있으면 실루엣 바깥쪽 조각이 팔이고,
       * 붙어 있으면 옷 구간(tx) 바깥의 맨살이 팔이다. 두 경우를 모두 본다 —
       * 떨어진 경우만 세면 팔을 몸에 붙이고 선 사진에서 팔이 "없는" 것이
       * 되어, 소매 끝이 해부학 추정값(골반 아래)까지 내려갔다. */
      if (r.cx0 - r.x0 > gap) { lastL = y; sep = true; }
      else if (r.tx0 >= 0 && r.tx0 - r.cx0 > gap) lastL = y;
      if (r.x1 - r.cx1 > gap) { lastR = y; sep = true; }
      else if (r.tx1 >= 0 && r.cx1 - r.tx1 > gap) lastR = y;
    }
    var anat = wristY(L);
    var end;
    if (lastL < 0 && lastR < 0) end = anat;                 // 팔을 못 찾았다
    else end = Math.min(lastL < 0 ? 1e9 : lastL, lastR < 0 ? 1e9 : lastR);
    body._arm = {
      separated: sep,
      found: lastL >= 0 || lastR >= 0,
      endY: clamp(end, L.shoulder.y + h * 0.04, L.bottom),
      anatomicalWrist: anat
    };
    return body._arm;
  }

  /* =======================================================================
   * 3-b. 실루엣만으로 랜드마크를 잡는다
   *
   * body.js 의 어깨·허리·골반은 **얼굴 박스에서 출발**한다. 그 얼굴 박스는
   * 피부색 규칙으로 찾는데, 반팔을 입어 팔이 길게 드러난 사진에서는 팔이
   * 얼굴보다 큰 살색 덩어리가 되어 팔을 얼굴로 잡는다. 그러면 턱이 배까지
   * 내려가고 어깨가 허리 아래로 가는 값이 나온다 — 실측에서
   * 어깨 440 · 허리 284 · 골반 419(정답 174 · 402 · 474)가 나왔다.
   *
   * saneLM 이 순서만 바로잡아 봐야 값 자체가 틀렸으니 옷은 엉뚱한 자리에
   * 붙는다. 사용자가 "찢어진 천을 붙인 수준"이라고 한 결과의 원인이 이것이다.
   *
   * 그래서 피팅은 얼굴을 거치지 않고 **실루엣 폭 프로파일에서 직접** 잡는다.
   * 서 있는 전신 사진에서 폭은 이렇게 변한다.
   *
   *   정수리 → (머리, 좁음) → 목(최소) → 어깨(급격히 넓어짐)
   *          → 허리(다시 좁아짐) → 골반(넓어짐) → 가랑이(둘로 갈라짐)
   *
   * 이 변화는 얼굴을 찾지 않아도 읽힌다. 피부색·조명·머리 길이에 흔들리지도
   * 않는다. 실패하면(누워 있거나 실루엣이 깨졌으면) 기존 값으로 되돌린다.
   * ===================================================================== */
  function silhouetteLM(rows, mask, skin, w, h) {
    var top = 0; while (top < h && (!rows[top] || rows[top].cx0 < 0)) top++;
    var bot = h - 1; while (bot > top && (!rows[bot] || rows[bot].cx0 < 0)) bot--;
    var H = bot - top;
    if (H < h * 0.35) return null;                 // 인물이 너무 작다

    var raw = new Float32Array(h);
    for (var y = top; y <= bot; y++) {
      var r = rows[y];
      raw[y] = (r && r.cx0 >= 0) ? (r.cx1 - r.cx0 + 1) : 0;
    }
    var sm = medianSmooth(raw, top, bot, Math.max(2, Math.round(H * 0.012)));

    /* ── 몸통 폭은 **옷 입은 부분**에서 잰다 ──────────────────────────
     * 팔이 몸통에 붙어 보이면 실루엣 폭에 팔 두께가 더해진다. 그 값으로
     * 옷을 재단하면 반팔 티셔츠가 팔까지 덮어 판초처럼 된다.
     *
     * 그런데 반팔을 입은 사람은 **팔이 맨살이고 몸통은 옷**이다.
     * 피부가 아닌 전경의 최장 구간을 재면 팔이 저절로 빠진다.
     * 긴팔을 입었으면 팔도 옷이라 함께 잡히는데, 그때는 긴팔 옷이
     * 팔을 덮는 것이 맞으므로 문제가 되지 않는다.
     * 상의를 벗고 있으면 옷 구간이 없으므로 실루엣 폭으로 되돌린다. */
    var rawT = new Float32Array(h);
    for (var y2 = top; y2 <= bot; y2++) {
      var bestRun = 0, run = 0;
      for (var x2 = 0; x2 < w; x2++) {
        var q2 = y2 * w + x2;
        if (mask[q2] && !(skin && skin[q2])) { run++; if (run > bestRun) bestRun = run; }
        else run = 0;
      }
      // 옷 구간이 실루엣의 40%도 안 되면 옷을 못 찾은 것이다
      rawT[y2] = bestRun >= raw[y2] * 0.40 ? bestRun : raw[y2];
    }
    var smT = medianSmooth(rawT, top, bot, Math.max(2, Math.round(H * 0.016)));

    function argmin(a, b, prof) {
      prof = prof || sm;
      a = Math.max(top, Math.round(a)); b = Math.min(bot, Math.round(b));
      var bi = a, bv = 1e9;
      for (var y = a; y <= b; y++) if (prof[y] > 2 && prof[y] < bv) { bv = prof[y]; bi = y; }
      return bi;
    }
    function argmax(a, b, prof) {
      prof = prof || sm;
      a = Math.max(top, Math.round(a)); b = Math.min(bot, Math.round(b));
      var bi = a, bv = -1;
      for (var y = a; y <= b; y++) if (prof[y] > bv) { bv = prof[y]; bi = y; }
      return bi;
    }

    /* 목 — 머리와 어깨 사이에서 가장 좁은 곳 */
    var neckY = argmin(top + H * 0.07, top + H * 0.26);
    var neckW = sm[neckY];
    if (!(neckW > 1)) return null;

    /* 어깨 — 목 아래에서 폭이 확 커지는 지점.
     * 최대 폭의 몇 %에 처음 닿는가로 잡아야 삼각근 끝이 아니라 어깨선이 된다.
     *
     * 폭은 **옷 프로파일**에서 읽는다. 실루엣으로 읽으면 어깨선(옷이 넓어지는
     * 높이)이 아니라 팔이 시작되는 높이를 잡는다 — 맨팔은 어깨보다 조금
     * 아래에서 시작하므로 어깨가 20px쯤 내려앉았고, 상의 전체가 그만큼
     * 아래로 밀렸다. */
    var shMaxY = argmax(neckY, top + H * 0.34, smT);
    var shMaxW = smT[shMaxY];
    if (!(shMaxW > neckW * 1.35)) {                // 옷으로 안 잡히면 실루엣으로
      shMaxY = argmax(neckY, top + H * 0.34);
      shMaxW = sm[shMaxY];
      if (!(shMaxW > neckW * 1.35)) return null;   // 어깨가 목보다 안 넓다 = 실루엣 이상
    }
    var shProf = smT[shMaxY] === shMaxW ? smT : sm;
    var target = neckW + (shMaxW - neckW) * 0.70;
    var shoulderY = shMaxY;
    for (var y2 = neckY; y2 <= shMaxY; y2++) {
      if (shProf[y2] >= target) { shoulderY = y2; break; }
    }

    /* 가랑이 — **아래에서 위로** 올라가며 두 다리가 합쳐지는 지점.
     *
     * 위에서 내려가며 "처음 둘로 갈라지는 행"을 찾으면 몸통 한복판에서
     * 걸린다. 팔이 몸에서 떨어져 있으면 그 행도 여러 조각이기 때문이다 —
     * 실측에서 골반이 314(정답 474)로 나온 원인이었다.
     * 발목 쪽은 반드시 두 조각이므로, 거기서 올라오며 하나로 합쳐지는
     * 첫 지점을 잡으면 팔에 속지 않는다. */
    var minRun = Math.max(2, Math.round(w * 0.012));
    function runCount(y) {
      var n = 0, run = -1;
      for (var x = 0; x < w; x++) {
        if (mask[y * w + x]) { if (run < 0) run = x; }
        else if (run >= 0) { if (x - run >= minRun) n++; run = -1; }
      }
      if (run >= 0 && w - run >= minRun) n++;
      return n;
    }
    var crotchY = -1, sawTwo = false;
    for (var y3 = Math.round(bot - H * 0.06); y3 > Math.round(top + H * 0.33); y3--) {
      var n3 = runCount(y3);
      if (n3 >= 2) sawTwo = true;
      else if (n3 === 1 && sawTwo) { crotchY = y3; break; }
    }
    var hipY = crotchY > 0 ? crotchY - H * 0.075 : top + H * 0.52;
    /* 골반은 "가랑이에서 일정 비율 위"가 아니라 **아랫몸이 가장 넓은 곳**이다.
     * 비율만 쓰면 다리가 긴 사람에게서 골반이 40px 넘게 내려갔고, 그만큼
     * 상의 밑단도 같이 내려갔다. 가랑이 위 구간에서 옷 폭의 최댓값을 찾되,
     * 그 값이 비율 추정보다 뚜렷하게 넓을 때만 바꾼다. */
    if (crotchY > 0) {
      /* 창은 가랑이 **바로 위**로 좁게 둔다. 넓게 잡으면 상의 밑단이
       * 창 안에 들어오는데, 상의가 하의보다 넓으면 그 밑단을 골반으로
       * 잡아 버린다 — 골반이 100px 위로 튀어 엉덩이 블록이 무릎까지
       * 늘어났다. 그리고 창의 **안쪽**에서 최대여야 한다: 끝에 붙은
       * 최댓값은 "여기가 제일 넓다"가 아니라 "창 밖이 더 넓다"는 뜻이다. */
      var hLo = Math.round(crotchY - H * 0.12), hHi = Math.round(crotchY - H * 0.03);
      var hCand = argmax(hLo, hHi, smT);
      if (hCand > hLo + 2 && hCand < hHi - 2 &&
          smT[hCand] > smT[clamp(Math.round(hipY), top, bot)] * 1.02) hipY = hCand;
    }
    hipY = clamp(hipY, shoulderY + H * 0.14, top + H * 0.62);

    /* 허리 — "가장 좁은 곳"을 쓰되, 그것이 **진짜 잘록한 지점일 때만** 쓴다.
     *
     * 팔이 몸통에 겹쳐 보이면 폭 프로파일이 팔이 끝나는 높이까지 넓게
     * 유지되다가 뚝 떨어진다. 그러면 최솟값이 탐색 구간의 맨 아래에 붙어
     * 허리가 골반 근처로 밀린다 — 실측에서 477(정답 402)이 나왔다.
     *
     * 구간 양 끝보다 뚜렷하게 좁아야 잘록한 것으로 인정하고, 아니면
     * 해부학 비율(어깨~골반의 62% 지점)로 둔다. 단조롭게 줄기만 하는
     * 프로파일에서 최솟값은 허리가 아니라 그냥 구간의 끝이다. */
    /* 겨드랑이 아래에서부터 찾는다. 소매가 걸린 높이는 옷 폭이 부풀어
     * 있어 기준값을 왜곡한다. */
    var wLo = Math.round(shoulderY + (hipY - shoulderY) * 0.42);
    var wHi = Math.round(hipY - H * 0.02);
    var cand = argmin(wLo, wHi, smT);
    /* 두 가지를 모두 만족해야 "잰 허리"로 인정한다.
     *   ① 구간의 **안쪽**일 것 — 최솟값이 끝에 붙어 있으면 잘록한 것이 아니라
     *      프로파일이 계속 줄어들고 있다는 뜻이다(허리가 골반까지 밀렸다).
     *   ② 충분히 **깊을 것** — 남성처럼 옆선이 밋밋하면 최솟값의 위치는
     *      픽셀 잡음이 정한다. 얕은 골을 믿고 40px 어긋난 적이 있다.
     * 둘 중 하나라도 아니면 해부학 비율로 둔다. 어깨(신장의 0.182)에서
     * 허리(0.38)·골반(0.47)까지의 표준 비율이 0.69다. */
    var interior = cand > wLo + 3 && cand < wHi - 3;
    var ref = (smT[clamp(wLo, top, bot)] + smT[clamp(wHi, top, bot)]) / 2;
    var anatW = shoulderY + (hipY - shoulderY) * 0.68;
    /* 골이 얕을수록 잰 값을 덜 믿는다. 6% 이상 들어가 있으면 그대로 쓰고,
     * 밋밋하면 해부학 비율 쪽으로 끌어당긴다 — 버리지도, 통째로 믿지도 않는다. */
    var depth = (ref > 0 && smT[cand] > 0) ? (ref / smT[cand] - 1) : 0;
    var trust = interior ? clamp(depth / 0.06, 0, 1) : 0;
    var waistY = Math.round(anatW + (cand - anatW) * trust);
    var bustY = argmax(shoulderY + H * 0.02, waistY - H * 0.01, smT);

    /* 위치는 실루엣에서, 폭은 옷 입은 부분에서.
     * 다만 **어깨만은 실루엣**을 쓴다. 어깨선 높이에서는 팔이 아직 몸통
     * 옆으로 내려오지 않아 실루엣이 곧 어깨 너비다. 반대로 민소매를 입으면
     * 옷 구간은 어깨끈 폭이라 어깨가 실제의 2/3로 줄어든다 — 그 값으로
     * 재킷을 재단하니 몸통 픽셀의 7%가 옷 밖으로 밀려났다. */
    function tw(y) { return smT[clamp(Math.round(y), top, bot)] || sm[clamp(Math.round(y), top, bot)]; }
    function sw(y) { return sm[clamp(Math.round(y), top, bot)]; }

    var out = {
      _sane: true, _from: 'silhouette',
      top: top, bottom: bot,
      chinY: Math.round(top + (neckY - top) * 0.80),
      headH: Math.round((neckY - top) * 0.80),
      bodyH: H,
      crotchY: crotchY > 0 ? Math.round(crotchY) : -1,
      shoulder: { y: Math.round(shoulderY), w: sw(shoulderY + H * 0.012) },
      /* 가슴은 옷 구간으로 재되 어깨 대비 하한을 둔다. 민소매·나시를 입으면
       * 옷 구간이 가슴이 아니라 앞판 폭이라 실제보다 한참 좁게 나오고,
       * 그 폭으로 재킷을 재단하면 옷이 통째로 가늘어진다. 사람의 가슴
       * 너비는 어깨(삼각근 포함)의 0.88 아래로는 내려가지 않는다. */
      bust: { y: Math.round(bustY), w: Math.max(tw(bustY), sw(shoulderY + H * 0.012) * 0.88) },
      waist: { y: Math.round(waistY), w: tw(waistY) },
      hip: { y: Math.round(hipY), w: tw(hipY) }
    };

    /* ── 받아들이기 전에 검산한다 ──
     * 이 판독은 실루엣이 온전할 때만 맞다. 옷과 배경의 색이 비슷하면
     * (흰옷+흰벽) 인물 마스크가 조각나고, 그러면 폭 프로파일이 의미를 잃어
     * 엉뚱한 값이 나온다. 검산 없이 썼더니 저대비 사진에서 치마가
     * 79픽셀만 덮이는 회귀가 났다.
     *
     * 사람이라면 반드시 참인 범위만 확인한다. 하나라도 어긋나면 이 판독을
     * 버리고 body.js 값으로 돌아간다 — 틀린 새 값보다 낡은 값이 낫다. */
    if (!inRange(out.shoulder.y, top + H * 0.10, top + H * 0.33)) return null;
    if (!inRange(out.waist.y, out.shoulder.y + H * 0.07, top + H * 0.56)) return null;
    if (!inRange(out.hip.y, out.waist.y + H * 0.02, top + H * 0.70)) return null;
    if (!(out.shoulder.w > H * 0.06 && out.shoulder.w < w * 0.95)) return null;
    if (!(out.waist.w > H * 0.04 && out.hip.w > H * 0.04)) return null;
    // 어깨가 허리보다 좁으면 팔이 잘려 나간 마스크다
    if (out.shoulder.w < out.waist.w * 0.75) return null;
    return out;
  }

  function inRange(v, a, b) { return isFinite(v) && v >= a && v <= b; }

  function medianSmooth(arr, a, b, win) {
    var out = new Float32Array(arr.length);
    for (var i = a; i <= b; i++) {
      var lo = Math.max(a, i - win), hi = Math.min(b, i + win), s = [];
      for (var j = lo; j <= hi; j++) s.push(arr[j]);
      s.sort(function (p, q) { return p - q; });
      out[i] = s[s.length >> 1];
    }
    return out;
  }

  /**
   * 랜드마크 순서 보정.
   * body.js의 자동 검출은 초안이며, 배경이 복잡하거나 팔이 몸에 붙어 있으면
   * 허리가 어깨보다 위로 올라오는 등 순서가 뒤집힌 값이 나올 수 있다. 그 값을
   * 그대로 TPS에 넣으면 옷이 뒤집혀 접히며 결과가 조용히 망가진다.
   * 해부학적으로 불가능한 배치는 여기서 잡아 표준 비율로 되돌린다.
   */
  function saneLM(lm) {
    if (lm._sane) return lm;
    var out = { _sane: true };
    Object.keys(lm).forEach(function (k) {
      out[k] = (lm[k] && typeof lm[k] === 'object') ? { y: lm[k].y, w: lm[k].w } : lm[k];
    });
    /* 반드시 정수로 남긴다.
     * 이 값들은 곧바로 rows[y] 의 색인이 되는데, clamp 의 경계가 소수라
     * 결과도 소수가 되면 rows[202.9] 가 undefined 로 나와 조용히 터진다.
     * 정면에서는 값이 범위 안이라 clamp 가 걸리지 않아 드러나지 않다가,
     * 옆모습에서 처음 터졌다. */
    var top = out.top, bot = out.bottom, H = Math.max(1, bot - top);
    out.chinY = Math.round(clamp(out.chinY, top, top + H * 0.26));
    out.shoulder.y = Math.round(clamp(out.shoulder.y, out.chinY + H * 0.015, top + H * 0.30));
    out.waist.y = Math.round(clamp(out.waist.y, out.shoulder.y + H * 0.10, top + H * 0.52));
    out.hip.y = Math.round(clamp(out.hip.y, out.waist.y + H * 0.04, top + H * 0.64));
    if (out.bust) {
      out.bust.y = Math.round(clamp(out.bust.y, out.shoulder.y + H * 0.03, out.waist.y - H * 0.01));
    }
    return out;
  }

  function bodyAnchors(body, spec, opts, garmentRef) {
    opts = opts || {};
    if (!body._lmSane) body._lmSane = saneLM(body.lm);
    var L = body._lmSane;
    garmentRef = garmentRef || GARMENTS.get(spec.id);
    if (!garmentRef) return null;
    var ease = opts.ease == null ? 1 : opts.ease;                // 여유분
    var lenAdj = opts.lengthAdj == null ? 0 : opts.lengthAdj;    // 기장 ±
    var shift = opts.shiftY == null ? 0 : opts.shiftY;

    var mvHalfB = opts.halfAt || null;
    function pair(y, halfScale, core) {
      var s = spanAt(body, y, core !== false);
      /* 하의도 옆모습 프로파일이 있으면 그쪽을 쓴다. 골반 높이에서 실루엣
       * 폭을 그대로 읽으면 손끝이 걸려 골반이 통째로 넓어진다. */
      var base = mvHalfB
        ? mvHalfB(clamp((y - L.shoulder.y) / Math.max(1, L.hip.y - L.shoulder.y), 0, 1))
        : s.w / 2;
      return { cx: s.cx, y: y, L: [s.cx - base * halfScale, y], R: [s.cx + base * halfScale, y] };
    }

    if (spec.cat === 'bottom') {
      var wY = L.waist.y + shift, hY = L.hip.y + shift;
      var hemKey = spec.hem || 'knee';
      var hemY = clamp((HEM_BODY[hemKey] || HEM_BODY.knee)(L) + lenAdj + shift, 0, body.h - 1);
      var pw = pair(wY, 1.02 * ease), ph = pair(hY, 1.03 * ease);
      var hemSpan = spanAt(body, hemY, true);
      var isSkirt = spec.shape === 'skirt';
      var hemHalf = (isSkirt
        ? (ph.R[0] - ph.L[0]) / 2 * (spec.flare || 1.25)
        : hemSpan.w / 2 * 1.14) * ease;
      var res = {
        waistL: pw.L, waistR: pw.R, hipL: ph.L, hipR: ph.R,
        hemL: [hemSpan.cx - hemHalf, hemY], hemR: [hemSpan.cx + hemHalf, hemY],
        _hemY: hemY, _topY: wY
      };
      if (!isSkirt) {
        /* 두 다리를 각각 붙잡는다. 밑단 높이에서 실루엣이 두 조각이면
         * 그 안쪽 가장자리가 곧 다리 사이다 — 추정할 필요가 없다. */
        /* 가랑이는 실루엣에서 이미 쟀다(silhouetteLM). 잰 값이 있으면 그걸
         * 쓰고, 없을 때만 비율로 추정한다. */
        var crotchY = clamp((L.crotchY > 0 ? L.crotchY : hY + (L.bottom - hY) * 0.11) + shift,
                            0, body.h - 1);
        var crSpan = spanAt(body, crotchY, true);
        res.crotchC = [crSpan.cx, crotchY];
        var hemEdges = legEdges(body, hemY, crSpan.cx, hemHalf);
        res.hemLin = [hemEdges.Lin, hemY];
        res.hemRin = [hemEdges.Rin, hemY];

        /* 다리별 대응점 6개 — 옷본의 legL/legR 과 같은 순서·같은 높이 */
        var lp = [], rp = [];
        [0, 0.5, 1].forEach(function (t) {
          var y = clamp(crotchY + t * (hemY - crotchY), 0, body.h - 1);
          var half = hemHalf + (1 - t) * Math.max(0, (ph.R[0] - ph.L[0]) / 2 - hemHalf);
          var e = legEdges(body, y, crSpan.cx, half);
          lp.push([e.Lout, y], [e.Lin, y]);
          rp.push([e.Rout, y], [e.Rin, y]);
        });
        res.legL = lp; res.legR = rp;
      }
      return res;
    }

    /* ── 상의·아우터·원피스 ────────────────────────────────────────────
     * 세로 좌표를 **옷본에서 역산한다.**
     *
     * 예전에는 몸 쪽에서도 목·겨드랑이·가슴 위치를 따로 계산했는데, 그러면
     * 옷본과 미세하게 어긋나고 그 어긋남이 TPS에서 접힘(fold)으로 증폭됐다.
     * 실측해 보니 중심선을 따라 매핑이 21번 뒤집혔고 몸통 픽셀의 39%가
     * 옷 바깥으로 날아갔다 — 가슴에 뚫린 구멍이 그것이었다.
     *
     * 그래서 어깨선과 밑단만 몸에서 정하고, 그 사이의 모든 지점은 **옷본이
     * 가진 비율 그대로** 배치한다. 정의상 순서가 뒤집힐 수 없다.
     * ---------------------------------------------------------------- */
    var gA = garmentRef.anchors, gG = garmentRef.geom;
    var gSh = gA.shL[1], gHem = gA.hemL[1];
    var gSpan = Math.max(1, gHem - gSh);

    var shY = clamp(L.shoulder.y + shift, 0, body.h - 1);
    var hemKey2 = spec.hem || 'hip';
    var hemY2 = clamp((HEM_BODY[hemKey2] || HEM_BODY.hip)(L) + lenAdj + shift, shY + body.h * 0.04, body.h - 1);
    var bSpan = hemY2 - shY;

    /** 옷본의 y → 몸의 y (어깨·밑단을 양 끝으로 하는 선형 대응) */
    function mapY(gy) { return clamp(shY + (gy - gSh) / gSpan * bSpan, 0, body.h - 1); }

    var axis = centerAxis(body, L);

    /* 몸통 반폭의 출처.
     * 옆모습을 재 두었으면 그 프로파일을 쓴다 — body.js 의 랜드마크 폭은
     * "어깨~허리 사이 최대 폭"이라 팔이 몸에 닿으면 부풀어 오르는데,
     * multiview 쪽은 분위수로 그 오염을 걷어낸 값이라 더 안정적이다.
     * 두 값이 다르면 옷 둘레와 몸 둘레가 어긋나 핏 판정이 틀어진다 —
     * 티셔츠가 실제보다 20% 크게 나왔던 원인이다.
     * 옆모습 시점에서는 보이는 폭이 곧 두께이므로 투영식으로 바꿔 준다. */
    var mvHalf = opts.halfAt || null;
    var halfOf = mvHalf
      ? function (y) { return mvHalf(clamp((y - L.shoulder.y) / Math.max(1, L.hip.y - L.shoulder.y), 0, 1)); }
      : function (y) { return torsoHalf(L, y); };

    /* ── 가로 폭 : 옷본의 폭 프로파일을 몸 크기로 옮기고, 체형은 **감쇠해서**
     *   섞는다.
     *
     * 몸에서 잰 폭을 그대로 쓰면 안 되는 이유가 실측에서 드러났다.
     * body.js의 어깨 폭은 삼각근이 가장 벌어지는 지점(팔 포함)이라 옷본의
     * 어깨 솔기보다 넓게 나온다. 그 결과 옷본은 어깨→겨드랑이로 좁아지는데
     * 몸 쪽 값은 넓어져, 두 폭 순서가 **반대 방향**이 됐다. TPS는 그 구간에서
     * 좌우로 접힐 수밖에 없고, 그것이 가슴에 뚫린 구멍의 정체였다.
     *
     * 그래서 폭의 **순서는 옷본이 정하고**, 몸의 체형은 그 위에 감쇠 지수로
     * 얹는다. 체형이 밋밋하면 옷본 그대로(접힘 없음), 허리가 들어간 체형이면
     * 옷도 그만큼 들어간다 — 다만 순서를 뒤집을 만큼은 아니다. */
    var DAMP = 0.60;
    var gLevels = [
      [gA.shL[1],    gG.shHalf],
      [gA.pitL[1],   gG.bodyHalf * 0.99],
      [gA.chestL[1], gG.bodyHalf],
      [gA.waistL[1], gG.waistHalf],
      [gA.hemL[1],   gG.hemHalf]
    ];
    var bodyAtLv = gLevels.map(function (lv) { return halfOf(mapY(lv[0])); });
    var gMed = CC.median(gLevels.map(function (lv) { return lv[1]; })) || 1;
    var bMed = CC.median(bodyAtLv) || 1;
    /* 옷의 치수감(spec.fit)을 되살린다.
     * 옷본의 중앙값으로 나누면 옷본에 들어 있던 fit 계수가 그대로 약분돼,
     * 슬림 티셔츠와 오버핏 후디가 **같은 폭으로** 그려졌다. 다시 곱해 준다. */
    var sizeScale = (bMed / gMed) * (spec.fit || 1);

    function halfFor(gy, gHalf) {
      var shapeR = Math.pow(clamp(halfOf(mapY(gy)) / bMed, 0.40, 2.2), DAMP);
      return gHalf * sizeScale * shapeR * ease;
    }
    function pairAt(gy, gHalf) {
      var y = mapY(gy), hf = halfFor(gy, gHalf);
      return { y: y, L: [axis - hf, y], R: [axis + hf, y] };
    }

    var neckY = mapY(gA.neckL[1]);
    var neckHalf = halfFor(gA.neckL[1], gG.cx - gA.neckL[0]);
    // spec.shoulderHalf 는 이미 옷본의 shHalf 에 반영되어 있다 — 다시 곱하면 두 번이다
    var shHalf = halfFor(gA.shL[1], gG.shHalf);

    var pit   = pairAt(gA.pitL[1], gG.bodyHalf * 0.99);
    var chest = pairAt(gA.chestL[1], gG.bodyHalf);
    var wp    = pairAt(gA.waistL[1], gG.waistHalf);
    var hemHalf2 = halfFor(gA.hemL[1], gG.hemHalf);

    /* ── 소매 ──────────────────────────────────────────────────────────
     * 소매만은 실루엣을 직접 본다. 팔의 각도와 굵기는 사람마다 다르고
     * 랜드마크에 들어 있지 않기 때문이다. 대신 팔이 실제로 끝나는 곳보다
     * 아래로는 가지 않게 막는다 — 그러지 않으면 다리나 배경이 소매로 끌려온다.
     * ---------------------------------------------------------------- */
    var sleeveKey = spec.sleeve || 'long';
    var arm = armInfo(body);
    /* 팔 끝은 재서 알아낸 값을 쓰고, 못 찾았을 때만 해부학 추정으로 간다 */
    var armEndY = arm.found ? arm.endY : wristY(L);
    var armY = shY + (armEndY - shY) * (SLEEVE_FRAC[sleeveKey] != null
      ? SLEEVE_FRAC[sleeveKey] : SLEEVE_FRAC.long);
    if (sleeveKey !== 'none') {
      armY = Math.min(armY, arm.endY - body.h * 0.008);
      /* 소맷부리는 겨드랑이보다 아래여야 한다. 위로 올라가면 소매 조각의
       * 대응점 순서가 뒤집혀 TPS가 그 자리에서 접힌다. */
      armY = Math.max(armY, pit.y + body.h * 0.015);
    }
    armY = clamp(armY, shY + body.h * 0.03, body.h - 1);
    var armEdge = limbEdges(body, armY);
    var armHalfBase = armEdge.sepL || armEdge.sepR
      ? Math.max(axis - armEdge.Lout, armEdge.Rout - axis)
      : halfFor(gA.armL[1], gG.cx - gA.armL[0]) / ease;
    /* 소매는 사람의 실루엣 밖으로 나갈 수 없다(여유분은 아래에서 곱한다).
     * 옷본 비율로만 잡았더니 소맷부리가 팔보다 23px 넓어져, 소매가 배경
     * 위에 걸쳐진 천 조각처럼 보였다. */
    var armSpan = spanAt(body, armY, false);
    if (armSpan.w > 2) armHalfBase = Math.min(armHalfBase, armSpan.w / 2 * 1.04);
    var armHalf = armHalfBase * ease;
    if (sleeveKey === 'none') armHalf = shHalf * 0.94;

    var elb = null;
    if (sleeveKey !== 'none' && gA.elbowOutL) {
      /* 팔꿈치 대응점도 소매 구간(겨드랑이~소맷부리) 안에서 잡는다.
       * 옷 기장에 대응시키면 소맷부리보다 아래로 내려가 소매가 뒤집힌다. */
      var gPitY = gA.pitL[1], gArmY = gA.armL[1];
      var te = clamp((gA.elbowOutL[1] - gPitY) / Math.max(1, gArmY - gPitY), 0, 1);
      var elY = clamp(pit.y + te * (armY - pit.y), 0, body.h - 1);
      var e = limbEdges(body, elY);
      var pad = body.w * 0.004 * ease;
      elb = {
        outL: [e.Lout - pad, elY], inL: [(e.sepL ? e.Lin : e.coreL) + pad, elY],
        outR: [e.Rout + pad, elY], inR: [(e.sepR ? e.Rin : e.coreR) - pad, elY]
      };
    }

    return {
      neckL: [axis - neckHalf, neckY], neckR: [axis + neckHalf, neckY],
      shL: [axis - shHalf, shY], shR: [axis + shHalf, shY],
      pitL: pit.L, pitR: pit.R,
      chestL: chest.L, chestR: chest.R,
      // 소매는 몸통과 따로 변형된다(buildParts 참고). 그래서 바깥 가장자리뿐
      // 아니라 안쪽 가장자리까지 필요하다 — 팔의 굵기를 알아야 소매가 팔을
      // 감싸지, 팔 옆에 널브러지지 않는다.
      elbowOutL: elb ? elb.outL : null, elbowOutR: elb ? elb.outR : null,
      elbowInL:  elb ? elb.inL  : null, elbowInR:  elb ? elb.inR  : null,
      armL: [axis - armHalf, armY], armR: [axis + armHalf, armY],
      cuffInL: [(armEdge.sepL ? armEdge.Lin : axis - armHalf * 0.55), armY],
      cuffInR: [(armEdge.sepR ? armEdge.Rin : axis + armHalf * 0.55), armY],
      waistL: wp.L, waistR: wp.R,
      hemL: [axis - hemHalf2, hemY2], hemR: [axis + hemHalf2, hemY2],
      _hemY: hemY2, _topY: Math.min(neckY, shY), _shY: shY, _neckY: neckY
    };
  }

  /**
   * 몸의 중심축.
   * 행마다 중심을 새로 재면 팔이 한쪽에서만 몸에 닿는 순간 중심이 흔들려
   * 옷이 좌우로 비뚤어진다. 어깨~골반 구간의 중앙값 하나로 고정한다.
   */
  function centerAxis(body, L) {
    if (body._axis != null) return body._axis;
    var cs = [];
    for (var y = Math.max(0, L.shoulder.y); y <= Math.min(body.h - 1, L.hip.y); y++) {
      var r = body.rows[y];
      if (r && r.cx0 >= 0) cs.push((r.cx0 + r.cx1) / 2);
    }
    if (!cs.length) return (body._axis = body.w / 2);
    cs.sort(function (a, b) { return a - b; });
    return (body._axis = cs[cs.length >> 1]);
  }

  /**
   * 높이 y에서의 몸통 반폭 — 랜드마크 폭 사다리를 선형 보간한다.
   * 골반 아래로는 골반 폭을 유지한다(치마·코트 밑단이 다리 폭으로 좁아지면 안 된다).
   */
  function torsoHalf(L, y) {
    var pts = [
      [L.shoulder.y, L.shoulder.w / 2],
      [L.bust ? L.bust.y : (L.shoulder.y + L.waist.y) / 2,
       (L.bust ? L.bust.w : Math.max(L.shoulder.w, L.waist.w)) / 2],
      [L.waist.y, L.waist.w / 2],
      [L.hip.y, L.hip.w / 2]
    ].filter(function (q) { return isFinite(q[0]) && isFinite(q[1]) && q[1] > 0; })
     .sort(function (a, b) { return a[0] - b[0]; });
    if (!pts.length) return 1;
    if (y <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (y <= pts[i][0]) {
        var t = (y - pts[i - 1][0]) / Math.max(1, pts[i][0] - pts[i - 1][0]);
        return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      }
    }
    return pts[pts.length - 1][1];
  }

  /* =======================================================================
   * 4-b. 원통 감기 (cylindrical wrap)
   *
   * 지금까지는 옷본의 가로 좌표를 실루엣 폭에 **선형으로** 폈다. 그러면 옷이
   * 몸을 감싸는 게 아니라 앞에 납작하게 붙는다. 몸통은 원기둥에 가까우므로
   * 실제로는 옆으로 갈수록 천이 급격히 줄어들어 보여야 한다.
   *
   * 단면을 반폭 a · 반두께 b 인 타원으로 두고 몸이 θ 만큼 돌아섰다고 하자.
   * 표면의 각위치 φ(0=정면 중앙, ±90°=옆선)에 있는 점이 화면에 찍히는 곳은
   *
   *      X(φ) = a·sinφ·cosθ + b·cosφ·sinθ = R·sin(φ + δ)
   *      R = √(a²cos²θ + b²sin²θ)  (= 관측되는 반폭)
   *      δ = atan2(b·sinθ, a·cosθ)
   *
   * 이므로, 실루엣 안의 정규화 위치 t = X/R 에서 거꾸로
   *
   *      φ = asin(t) − δ
   *
   * 를 얻는다. b/a 는 옆모습 사진에서 **잰 값**을 쓴다(multiview.js).
   * 옆모습이 없으면 0.72 를 쓰되, 그때는 이 값이 가정임을 화면에 밝힌다.
   *
   * |φ| > 90° 는 옷본에 없는 뒷면이다. 접어서 되비추면(중앙 앞섶이 중앙 뒤로
   * 간다) 대칭 의류에서는 자연스럽게 이어진다.
   * ===================================================================== */
  var DEFAULT_DEPTH_RATIO = 0.72;

  function wrapU(t, delta) {
    var phi = Math.asin(clamp(t, -1, 1)) - delta;      // 라디안
    var u = phi / (Math.PI / 2);                       // −1 … +1 이 앞면
    if (u > 1) u = 2 - u;                              // 뒷면을 접어 되비춘다
    else if (u < -1) u = -2 - u;
    return clamp(u, -1, 1);
  }

  /** 옷본의 높이별 반폭 — 감기 좌표를 정규화하는 데 쓴다 */
  function garmentHalfFn(G, spec) {
    var A = G.anchors, lv = [];
    var keys = spec.cat === 'bottom'
      ? [['waistL', 'waistR'], ['hipL', 'hipR'], ['hemL', 'hemR']]
      : [['neckL', 'neckR'], ['shL', 'shR'], ['pitL', 'pitR'],
         ['chestL', 'chestR'], ['waistL', 'waistR'], ['hemL', 'hemR']];
    keys.forEach(function (kk) {
      var l = A[kk[0]], r = A[kk[1]];
      if (l && r) lv.push([(l[1] + r[1]) / 2, (r[0] - l[0]) / 2]);
    });
    if (!lv.length) return null;
    lv.sort(function (a, b) { return a[0] - b[0]; });
    return function (gy) {
      if (gy <= lv[0][0]) return lv[0][1];
      for (var i = 1; i < lv.length; i++) {
        if (gy <= lv[i][0]) {
          var t = (gy - lv[i - 1][0]) / Math.max(1, lv[i][0] - lv[i - 1][0]);
          return lv[i - 1][1] + (lv[i][1] - lv[i - 1][1]) * t;
        }
      }
      return lv[lv.length - 1][1];
    };
  }

  /* =======================================================================
   * 5. 합성 — 변형 · 가림 · 조명 이식 · 드러난 부분 메우기
   * ===================================================================== */
  /* ── 부위 분할 워핑 ────────────────────────────────────────────────
   * 몸통과 소매를 **하나의** TPS로 묶으면 지도가 접힌다(non-injective).
   * 옷본에서는 소매가 몸통 옆에 붙어 아래로 뻗지만, 사진 속 팔은 벌어진
   * 각도도 굵기도 제각각이라 두 배치를 하나의 매끄러운 변형으로 이을 수
   * 없기 때문이다. 실제로 그렇게 했더니 가슴 한복판에 구멍이 뚫렸다.
   *
   * 그래서 옷을 세 조각으로 나눠 각각 변형한다. 조각마다 대응 관계가
   * 거의 아핀에 가까워져 접힘이 사라진다. 실제 가상 피팅 연구가 부위별
   * 워핑(part-based warping)을 쓰는 것도 같은 이유다.
   *
   *   몸통  : 목·어깨·겨드랑이·가슴·허리·밑단 12점
   *   소매  : 어깨끝·겨드랑이·팔꿈치(안/밖)·소맷부리(안/밖) 6점 × 좌우
   *
   * 조각의 경계는 **옷본 좌표**에서 정한다(겨드랑이 높이와 몸통 폭).
   * 결과 좌표에서 나누면 팔이 몸에 붙은 사진에서 경계가 사라진다.
   * ------------------------------------------------------------------ */
  var KEYS_TORSO = ['neckL', 'neckR', 'shL', 'shR', 'pitL', 'pitR',
                    'chestL', 'chestR', 'waistL', 'waistR', 'hemL', 'hemR'];
  var KEYS_TOP = KEYS_TORSO;      // 하위 호환 (외부에서 참조)
  var KEYS_BOTTOM = ['waistL', 'waistR', 'hipL', 'hipR', 'crotchC', 'hemLin', 'hemRin', 'hemL', 'hemR'];

  /**
   * 몸통 대응점들로부터 "높이별 허용 반폭" 함수를 만든다.
   * 여유분·오버사이즈는 이미 대응점 좌표에 반영되어 있으므로, 여기에
   * 약간의 여유(12%)만 더하면 오버핏 옷도 실루엣 밖으로 자연스럽게 나간다.
   */
  function torsoBound(A, wideAboveY) {
    /* 소매가 붙는 높이(어깨~소맷부리)에서는 울타리를 크게 연다.
     *
     * 좁게 잡았더니 겨드랑이에 살색 쐐기가 남았다. 그 자리를 옷본 좌표는
     * "몸통"이라 하고(=소매 조각이 거절) 몸 좌표는 "몸통 밖"이라 해서
     * (=몸통 조각이 거절) 아무도 그리지 않았기 때문이다.
     * 소매는 이미 먼저 그려졌으므로, 남은 자리는 몸통이 메우는 것이 맞다.
     * 소맷부리 아래는 팔뚝이라 좁게 유지한다 — 그러지 않으면 손목에
     * 몸통 천이 얹힌다. */
    var armY = wideAboveY != null ? wideAboveY
      : (A.armL ? A.armL[1] : (A.hemL ? A.hemL[1] : 1e9));
    var lv = [];
    ['neck', 'sh', 'pit', 'chest', 'waist', 'hip', 'hem'].forEach(function (k) {
      var l = A[k + 'L'], r = A[k + 'R'];
      if (l && r) lv.push([(l[1] + r[1]) / 2, (r[0] - l[0]) / 2, (l[0] + r[0]) / 2]);
    });
    if (!lv.length) return null;
    lv.sort(function (a, b) { return a[0] - b[0]; });
    function halfAt(y) {
      var i, half, cx;
      if (y <= lv[0][0]) { half = lv[0][1]; cx = lv[0][2]; }
      else if (y >= lv[lv.length - 1][0]) {
        half = lv[lv.length - 1][1]; cx = lv[lv.length - 1][2];
      } else {
        for (i = 1; i < lv.length; i++) {
          if (y <= lv[i][0]) {
            var t = (y - lv[i - 1][0]) / Math.max(1, lv[i][0] - lv[i - 1][0]);
            half = lv[i - 1][1] + (lv[i][1] - lv[i - 1][1]) * t;
            cx = lv[i - 1][2] + (lv[i][2] - lv[i - 1][2]) * t;
            break;
          }
        }
      }
      return { half: half, cx: cx };
    }
    return {
      halfAt: halfAt,
      test: function (x, y) {
        var q = halfAt(y);
        var k = y <= armY + 2 ? 1.55 : 1.12;
        return Math.abs(x - q.cx) <= q.half * k + 2;
      }
    };
  }

  function pairsOf(keys, dstA, srcA) {
    var dst = [], src = [];
    keys.forEach(function (k) {
      if (dstA[k] && srcA[k]) { dst.push(dstA[k]); src.push(srcA[k]); }
    });
    return { dst: dst, src: src };
  }

  /**
   * 좌우 대응점의 **중점**을 대응점으로 추가한다.
   *
   * 대응점이 전부 실루엣 좌우 끝에만 있으면 몸 한복판에는 아무 구속이 없다.
   * TPS는 그 빈 곳에서 자유롭게 휘고, 실제로 중심선을 따라가 보면 매핑이
   * 옷본 밖(-219)에서 시작해 427까지 치솟았다가 되돌아 내려왔다.
   * 가운데가 부풀어 오르니 가슴 픽셀이 옷 밖으로 밀려난 것이다.
   *
   * 좌우가 대칭이라 중점은 곧 중심선 위의 같은 높이 지점이며, 새로 측정할
   * 것도 가정할 것도 없다. 이 점들을 넣는 것만으로 중앙의 자유도가 사라진다.
   */
  function withCenters(pairs) {
    var dst = pairs.dst.slice(), src = pairs.src.slice();
    for (var i = 0; i + 1 < pairs.dst.length; i += 2) {
      dst.push([(pairs.dst[i][0] + pairs.dst[i + 1][0]) / 2,
                (pairs.dst[i][1] + pairs.dst[i + 1][1]) / 2]);
      src.push([(pairs.src[i][0] + pairs.src[i + 1][0]) / 2,
                (pairs.src[i][1] + pairs.src[i + 1][1]) / 2]);
    }
    return { dst: dst, src: src };
  }

  /** 좌우가 짝을 이루는 키만 남긴다 — 중점을 만들려면 짝이 온전해야 한다 */
  function pairedOnly(keys, dstA, srcA) {
    var dst = [], src = [];
    for (var i = 0; i + 1 < keys.length; i += 2) {
      var a = keys[i], b = keys[i + 1];
      if (dstA[a] && srcA[a] && dstA[b] && srcA[b]) {
        dst.push(dstA[a], dstA[b]); src.push(srcA[a], srcA[b]);
      }
    }
    return { dst: dst, src: src };
  }

  function buildParts(spec, G, anchors) {
    var parts = [];
    if (spec.cat === 'bottom') {
      /* 치마는 한 덩어리라 하나의 변형으로 충분하다.
       * 바지는 다리가 둘이므로 소매와 같은 이유로 조각을 나눈다 —
       * 한 지도로 묶으면 안쪽 솔기가 벌어져 두 다리가 치마처럼 붙어 버린다. */
      var pb = withCenters(pairedOnly(
        ['waistL', 'waistR', 'hipL', 'hipR', 'hemLin', 'hemRin', 'hemL', 'hemR'],
        anchors, G.anchors));
      if (anchors.crotchC && G.anchors.crotchC) {
        pb.dst.push(anchors.crotchC); pb.src.push(G.anchors.crotchC);
      }
      /* 하의에도 **몸 쪽 울타리**가 필요하다.
       * TPS는 대응점 바깥으로도 매끄럽게 이어지므로, 허리 옆에 붙어 있는
       * 팔뚝이 옷본 안쪽 좌표로 떨어져 청바지가 팔에 칠해졌다. 울타리는
       * 허리·골반 대응점이 만든 폭 자체다(소매 같은 확장 구간은 없다). */
      var bBound = torsoBound(anchors, -1e9);
      if (!anchors.legL || !G.anchors.legL) {
        if (pb.dst.length >= 4) {
          parts.push({ name: 'bottom', dst: pb.dst, src: pb.src, test: null,
                       bound: bBound, wrap: true });
        }
        return parts;
      }

      var gcx = G.geom.cx, gCrotch = G.anchors.crotchC[1];
      [['legL', -1], ['legR', 1]].forEach(function (sd) {
        var key = sd[0], sign = sd[1];
        parts.push({
          name: key, dst: anchors[key], src: G.anchors[key],
          test: function (gx, gy) { return gy >= gCrotch && (gx - gcx) * sign >= -1; }
        });
      });
      // 엉덩이·허리 블록은 가랑이 위쪽만 맡는다
      parts.push({
        name: 'seat', dst: pb.dst, src: pb.src, wrap: true, bound: bBound,
        clampFn: function (uv) { if (uv[1] > gCrotch) uv[1] = gCrotch; }
      });
      return parts;
    }

    var pt = withCenters(pairedOnly(KEYS_TORSO, anchors, G.anchors));
    if (pt.dst.length < 4) return parts;
    var gm = G.geom, cx = gm.cx, pitY = gm.armpitY, half = (gm.bodyHalf || 0) * 1.02;
    /* 잘라 읽는 경계는 **솔기에서 확실히 떨어뜨린다.**
     * 옷본의 겨드랑이 솔기는 어깨점에서 겨드랑이까지 비스듬히 내려오는
     * 한 줄인데, 자르는 열이 그 위에 걸치면 그 한 줄이 잘린 픽셀마다
     * 되풀이돼 가슴에 눈썹 모양 검은 곡선 두 개가 그려진다. 솔기 안쪽
     * 12% 지점이면 어느 높이에서도 민무늬 천이다.
     * (소매 조각의 경계 half 와는 다른 값이어야 한다 — 그쪽을 좁히면
     *  소매가 몸통 천까지 가져간다.) */
    var clampHalf = (gm.bodyHalf || 0) * 0.88;

    /* 겨드랑이 **위쪽**에도 울타리가 필요하다.
     * 지금까지 요크(어깨~목선)는 옷본 어디든 읽을 수 있었다. 그런데 몸에서
     * 어깨점 바로 아래 바깥선은 아직 몸통이고, 옷본에서 같은 자리는 이미
     * 소매다. 그래서 요크가 소매와 진동(armhole) 솔기를 읽어 어깨를 가로지르는
     * 사선 얼룩이 생겼다 — 아우터 열 벌이 전부 그랬다.
     * 진동 솔기는 어깨점에서 겨드랑이로 내려오는 선이고, 그 안쪽이 몸통이다.
     * 대응점 두 개(shL·pitL)가 그 선을 이미 알려 준다. */
    var gShA = G.anchors.shL, gPitA = G.anchors.pitL;
    var yokeHalfAt = (gShA && gPitA && pitY > gShA[1])
      ? function (gy) {
          var t = Math.max(0, Math.min(1, (gy - gShA[1]) / (pitY - gShA[1])));
          return (cx - (gShA[0] + (gPitA[0] - gShA[0]) * t)) * 0.985;
        }
      : null;

    /* 소매를 **먼저** 칠한다. 소매는 팔을 정확히 맞히는 것이 목적이라
     * 옷본의 소매 영역에 제대로 떨어진 픽셀만 그린다(엄격).
     * 그 다음 몸통이 남은 자리를 메운다(관대). 순서가 반대면 몸통이
     * 팔까지 덮어써서 소매 변형이 무의미해진다. */
    // 캡 소매처럼 소맷부리가 겨드랑이보다 위면 옷본이 소매 대응점을 내주지
    // 않는다. 그때는 몸통 요크가 그대로 맡는다.
    if ((spec.sleeve || 'long') !== 'none' && G.anchors.cuffInL) addSleeves();

    /* 몸통 조각 : 겨드랑이 아래에서는 옷본의 몸통 폭 **안쪽으로 잘라서** 읽는다.
     * 바깥으로 나간 좌표를 버리면(reject) 그 픽셀이 빈 채로 남아 가슴 한복판에
     * 구멍이 뚫린다 — 실제로 그렇게 나왔다. 잘라서 읽으면 몸통 옆선의 천을
     * 이어 붙이게 되므로 구멍 대신 옷감이 채워진다. */
    parts.push({
      name: 'torso', dst: pt.dst, src: pt.src,
      clampFn: function (uv) {
        var lim = clampHalf;
        if (uv[1] < pitY) {
          if (!yokeHalfAt) return;
          lim = yokeHalfAt(uv[1]);
        }
        if (uv[0] < cx - lim) uv[0] = cx - lim;
        else if (uv[0] > cx + lim) uv[0] = cx + lim;
      },
      /* 몸통은 옷본 좌표를 잘라서 읽으므로(구멍 방지) 무엇이든 칠할 수 있다.
       * 그래서 **몸 쪽에서도** 울타리를 쳐야 한다. 없으면 팔뚝처럼 몸통
       * 바깥이면서 인물 안쪽인 자리에 몸통 천이 얹혀, 손목에 천 조각이
       * 붙은 것처럼 보인다. 울타리는 대응점이 만든 몸통 폭 자체다. */
      bound: torsoBound(anchors),
      wrap: true
    });
    return parts;

    function addSleeves() {
    [['L', -1], ['R', 1]].forEach(function (sd) {
      var side = sd[0], sign = sd[1];
      var keys = ['sh' + side, 'pit' + side, 'elbowOut' + side, 'elbowIn' + side,
                  'arm' + side, 'cuffIn' + side];
      var gsrc = {};
      keys.forEach(function (k) { gsrc[k] = G.anchors[k]; });
      var ps = pairsOf(keys, anchors, gsrc);
      if (ps.dst.length < 4) return;

      /* ── 소매가 갈 수 있는 자리를 몸 쪽에서도 못박는다 ──────────────
       * 조각마다 TPS는 대응점 **바깥으로도** 매끄럽게 이어진다. 그래서
       * 가슴 한복판의 픽셀이 옷본의 소매 안쪽 좌표로 떨어질 수 있고,
       * 그러면 소매 밑단 솔기가 가슴에 눈썹 모양 곡선 두 개로 그려진다 —
       * 실제로 그렇게 나왔다.
       * 소매는 어깨점~소맷부리 사이의 **팔 쪽 띠**에만 있을 수 있다.
       * 안쪽 경계는 어깨점 → 겨드랑이 → 소맷부리 안쪽을 잇는 선이고,
       * 바깥 경계는 그 조각에서 가장 바깥으로 나간 대응점이다. */
      var aSh = anchors['sh' + side], aPit = anchors['pit' + side];
      var aArm = anchors['arm' + side], aCuf = anchors['cuffIn' + side];
      var aElb = anchors['elbowOut' + side];
      var sleeveW = Math.abs(aArm[0] - aCuf[0]) || Math.abs(aSh[0] - aPit[0]) || 8;
      var m = sleeveW * 0.14;
      var inner = [[aSh[1], aSh[0]], [aPit[1], aPit[0]], [aArm[1], aCuf[0]]]
        .sort(function (a, b) { return a[0] - b[0]; });
      var outs = [aSh[0], aArm[0]];
      if (aElb) outs.push(aElb[0]);
      var outX = sign < 0 ? Math.min.apply(null, outs) : Math.max.apply(null, outs);
      var yPad = Math.max(4, (aArm[1] - aSh[1]) * 0.06);
      var yTop = aSh[1] - yPad, yBot = aArm[1] + yPad;
      var xspanFn = function (y) {
        if (y < yTop || y > yBot) return null;
        var q = inner[inner.length - 1][1];
        if (y <= inner[0][0]) q = inner[0][1];
        else for (var i = 1; i < inner.length; i++) {
          if (y <= inner[i][0]) {
            var t = (y - inner[i - 1][0]) / Math.max(1, inner[i][0] - inner[i - 1][0]);
            q = inner[i - 1][1] + (inner[i][1] - inner[i - 1][1]) * t;
            break;
          }
        }
        return sign < 0 ? [outX - m, q + m] : [q - m, outX + m];
      };
      // 소맷부리 **아래**도 막아야 한다. TPS는 대응점 밖에서도 계속 이어지므로,
      // 손목 아래로 외삽된 좌표가 다시 소매 안으로 떨어지면 팔목에 천 조각이
      // 뜬금없이 생긴다 — 실제로 초록 밴드가 그렇게 나타났다.
      var cuffLimit = G.anchors['arm' + side][1] * 1.03;
      parts.push({
        name: 'sleeve' + side, dst: ps.dst, src: ps.src, tight: true, xspan: xspanFn,
        test: function (gx, gy) {
          return gy >= pitY * 0.92 && gy <= cuffLimit && (gx - cx) * sign > half * 0.94;
        }
      });
    });
    }
  }

  function waistYpre(L) { return L.waist.y; }

  /**
   * 한 행에서 팔과 몸통의 가장자리를 분리한다.
   * 몸통은 "가장 긴 연속 구간"이다(body.js의 정의와 같다). 그 왼쪽/오른쪽에
   * 따로 떨어진 구간이 있으면 그것이 팔이다. 팔이 몸에 붙어 있으면 구간이
   * 하나뿐이고, 그때는 팔 가장자리 = 몸통 가장자리로 둔다.
   */
  function limbEdges(body, y) {
    var runs = runsAt(body, y);
    var core = spanAt(body, y, true);
    var res = { coreL: core.x0, coreR: core.x1, cx: core.cx,
                Lout: core.x0, Lin: core.x0, Rout: core.x1, Rin: core.x1, sepL: false, sepR: false };
    if (runs.length < 2) return armFromSkin(body, y, res);
    var big = 0;
    for (var i = 1; i < runs.length; i++) {
      if (runs[i][1] - runs[i][0] > runs[big][1] - runs[big][0]) big = i;
    }
    res.coreL = runs[big][0]; res.coreR = runs[big][1];
    res.cx = (res.coreL + res.coreR) / 2;
    res.Lout = res.coreL; res.Lin = res.coreL;
    res.Rout = res.coreR; res.Rin = res.coreR;
    for (var j = big - 1; j >= 0; j--) {           // 몸통 왼쪽의 가장 가까운 구간
      res.Lout = runs[j][0]; res.Lin = runs[j][1]; res.sepL = true; break;
    }
    for (var k = big + 1; k < runs.length; k++) {  // 오른쪽
      res.Rout = runs[k][1]; res.Rin = runs[k][0]; res.sepR = true; break;
    }
    return armFromSkin(body, y, res);
  }

  /**
   * 팔이 몸통에 붙어 보이는 행에서 팔의 가장자리를 찾는다.
   *
   * 실루엣이 한 조각이면 팔이 없는 것이 아니라 **팔이 몸에 닿아 있는 것**이다.
   * 사진에서는 그쪽이 오히려 흔하다. 그런데 조각 개수로만 판단하면 소매가
   * 붙잡을 좌표가 없어져, 옷본 비율로 찍은 자리에 소매가 널브러진다 —
   * 초록 반팔이 팔꿈치께에 벙어리장갑처럼 얹힌 것이 그 결과였다.
   *
   * 반팔이면 팔은 맨살, 몸통은 옷이므로 옷 구간(tx)의 바깥이 곧 팔이다.
   * 그 폭이 팔로서 그럴듯한 범위일 때만 받아들인다.
   */
  function armFromSkin(body, y, res) {
    var r = body.rows[clamp(Math.round(y), 0, body.h - 1)];
    if (!r || r.tx0 < 0) return res;
    var lo = body.w * 0.012, hi = body.w * 0.20;
    if (!res.sepL) {
      var dL = r.tx0 - r.cx0;
      if (dL >= lo && dL <= hi) {
        res.Lout = r.cx0; res.Lin = r.tx0; res.coreL = r.tx0; res.sepL = true;
      }
    }
    if (!res.sepR) {
      var dR = r.cx1 - r.tx1;
      if (dR >= lo && dR <= hi) {
        res.Rout = r.cx1; res.Rin = r.tx1; res.coreR = r.tx1; res.sepR = true;
      }
    }
    return res;
  }

  /**
   * 한 높이에서 두 다리의 바깥·안쪽 가장자리.
   * 실루엣이 두 조각으로 갈라져 있으면 그대로 읽고, 붙어 있으면(발을 모은
   * 자세, 롱스커트 아래) 중심에서 비율로 나눈다.
   */
  function legEdges(body, y, cx, half) {
    var runs = runsAt(body, y);
    var two = runs.filter(function (r) { return r[1] - r[0] > body.w * 0.015; });
    if (two.length >= 2) {
      two.sort(function (a, b) { return (b[1] - b[0]) - (a[1] - a[0]); });
      two = two.slice(0, 2).sort(function (a, b) { return a[0] - b[0]; });
      if (two[0][1] < cx && two[1][0] > cx) {
        return { Lout: two[0][0], Lin: two[0][1], Rout: two[1][1], Rin: two[1][0] };
      }
    }
    var sp = spanAt(body, y, true);
    var h2 = half || sp.w / 2;
    return { Lout: cx - h2, Lin: cx - h2 * 0.16, Rout: cx + h2, Rin: cx + h2 * 0.16 };
  }

  /** 한 행의 연속 구간들 — 두 다리를 구분하려면 이게 필요하다 */
  function runsAt(body, y) {
    var w = body.w, r = clamp(Math.round(y), 0, body.h - 1);
    var out = [], run = -1;
    for (var x = 0; x < w; x++) {
      if (body.mask[r * w + x]) { if (run < 0) run = x; }
      else if (run >= 0) { if (x - run > w * 0.012) out.push([run, x - 1]); run = -1; }
    }
    if (run >= 0 && w - run > w * 0.012) out.push([run, w - 1]);
    return out;
  }

  /**
   * @param body    prepare() 결과
   * @param layers  [{ garmentId, colorHex, material, cluster, mode, opts }] — 아래→위 순서
   */
  function compose(body, layers, opts) {
    opts = opts || {};
    var w = body.w, h = body.h;
    var out = new ImageData(w, h);
    out.data.set(body.image.data);
    var od = out.data;

    var report = { layers: [], warnings: [] };
    var covered = new Uint8Array(w * h);   // 지금까지 옷이 덮은 영역
    var bandTop = Infinity, bandBot = -Infinity;
    var legHem = null, sleeveEnd = null;

    for (var li = 0; li < layers.length; li++) {
      var res = applyLayer(body, layers[li], od, covered, opts);
      if (!res) continue;
      report.layers.push(res);
      // 원래 옷을 지울 범위는 **실제로 입힌 옷이 덮는 세로 구간**이다.
      // 고정된 몸통 밴드로 잡으면 아무것도 안 입힌 부위까지 지우게 된다.
      if (res.anchors._topY != null) bandTop = Math.min(bandTop, res.anchors._topY);
      if (res.anchors._hemY != null) bandBot = Math.max(bandBot, res.anchors._hemY);
      // 새 옷이 원래 옷보다 짧으면 그 아래는 **맨살이 드러나야 한다.**
      // 어디부터가 맨살인지는 옷의 밑단·소매끝이 알려준다.
      if (res.cat === 'bottom' || res.cat === 'dress') {
        legHem = legHem == null ? res.anchors._hemY : Math.max(legHem, res.anchors._hemY);
      }
      if ((res.cat === 'top' || res.cat === 'outer') && res.anchors.armL) {
        var ay = res.anchors.armL[1];
        sleeveEnd = sleeveEnd == null ? ay : Math.max(sleeveEnd, ay);
      }
    }

    /* --- 옷을 갈아입으면서 드러난 원래 옷 지우기 ---
     * VITON 계열의 "clothing-agnostic representation"에 해당하는 단계다.
     * 다만 우리는 생성하지 않고 주변 색으로 확산시킨다. */
    if (opts.eraseOriginal !== false) {
      var reveal = new Uint8Array(w * h), known = new Uint8Array(w * h), nRev = 0;
      var L = body._lmSane || body.lm;
      /* 새 옷의 목선이 원래 옷보다 깊으면 그 사이에 원래 옷깃이 남는다.
       * 목 밑동까지 올려 잡아야 그 띠가 사라진다. 목·얼굴은 피부라 제외되므로
       * 위로 올려도 얼굴이 지워지지는 않는다. */
      var top = Math.round(Math.max(0, Math.min(
        (bandTop === Infinity ? L.shoulder.y : bandTop),
        L.chinY + L.headH * 0.15
      ) - L.headH * 0.05));
      /* 아래쪽 경계 — **발과 신발은 건드리지 않는다.**
       * 밑단 조금 아래까지 지우는 것은 옷 경계의 자투리를 없애려는 것인데,
       * 발목까지 오는 바지에서는 그 "조금 아래"가 이미 신발 자리다. 거기를
       * 지우고 피부색으로 칠하니 신발 위에 살색 띠가 생겼다.
       * 무릎 아래로 짧아진 바지(반바지·크롭)는 여전히 정강이를 지운다. */
      var shoeTop = L.bottom - (L.bottom - L.hip.y) * 0.07;
      var bandBotY = bandBot === -Infinity ? L.hip.y : bandBot;
      var botRaw = bandBotY + L.headH * 0.10;
      var bot;
      if (legHem != null && legHem < shoeTop) {
        /* 새 하의가 신발선보다 위에서 끝난다 = 반바지·크롭.
         * 밑단부터 신발선까지는 **드러난 다리**이므로, 원래 바지를 지우고
         * 피부로 칠해야 한다. 밑단 조금 아래에서 멈추면 반바지 아래로
         * 원래 청바지가 그대로 남는다 — 반바지를 넣자마자 그렇게 나왔다. */
        bot = Math.round(Math.min(h - 1, shoeTop));
      } else {
        bot = Math.round(Math.min(h - 1, botRaw, Math.max(shoeTop, bandBotY)));
      }
      for (var y = top; y <= bot; y++) {
        for (var x = 0; x < w; x++) {
          var p = y * w + x;
          if (!body.mask[p]) continue;
          if (covered[p]) { known[p] = 1; continue; }
          if (body.skin[p]) { known[p] = 1; continue; }   // 피부는 원래 그대로가 맞다
          reveal[p] = 1; nRev++;
        }
      }
      /* --- 드러난 부분을 두 종류로 나눈다 ---
       * (가) 맨살이 나와야 하는 곳 : 새 옷의 밑단 아래 다리, 소매끝 아래 팔.
       *      여기는 "무엇이 있어야 하는지"를 안다 — 이 사람의 피부다.
       *      얼굴에서 잰 피부색에 그 자리의 빛을 곱해 칠한다. 추측이 아니라 계산이다.
       * (나) 그 밖의 자투리 : 옷 경계의 틈. 여기는 무엇이 있어야 하는지 모른다.
       *      주변 색을 확산시킬 뿐이며, 넓어지면 티가 난다 — 그래서 면적을 보고한다. */
      var skinRGB = CC.labToRgb(body.skinLab.L, body.skinLab.a, body.skinLab.b);
      /* 밝기의 기준은 **피부색을 잰 곳**이어야 한다.
       * 몸 전체 평균으로 나누면 어두운 바지가 평균을 끌어내려, 밝은 자리에
       * 칠한 피부가 실제 얼굴빛보다 환하게 떠 보인다 — 옷깃 안의 윗가슴이
       * 목보다 밝게 나온 것이 그것이다. */
      var lsum = 0, ln = 0;
      var fy0 = Math.max(0, L.headTop != null ? L.headTop : L.top);
      var fy1 = Math.min(h - 1, L.chinY);
      for (var fy = fy0; fy <= fy1; fy++) {
        for (var fx = 0; fx < w; fx++) {
          var fp = fy * w + fx;
          if (body.skin[fp] && body.mask[fp]) { lsum += body.light[fp]; ln++; }
        }
      }
      if (ln < 40) {                                  // 얼굴을 못 찾았으면 몸 전체로
        lsum = 0; ln = 0;
        for (var s0 = 0; s0 < w * h; s0++) if (body.mask[s0]) { lsum += body.light[s0]; ln++; }
      }
      var lmeanB = ln ? lsum / ln : 128;

      /* 옷의 구멍은 허리 위에서만 찾는다. 아래에서는 두 다리 사이가
       * 좌·우·아래로 둘러싸인 것처럼 보일 수 있다. */
      var waistLine = L.waist.y;
      var hasOuter = false;
      for (var lo = 0; lo < report.layers.length; lo++) {
        if (report.layers[lo].cat === 'outer') hasOuter = true;
      }
      var hLim = Math.max(6, Math.round(w * 0.22));
      var vLim = Math.max(6, Math.round(h * 0.10));
      function enclosed(x, y) {
        var i, base = y * w, ok = 0;
        for (i = 1; i <= hLim && x - i >= 0; i++) if (covered[base + x - i]) { ok |= 1; break; }
        if (!(ok & 1)) return false;
        for (i = 1; i <= hLim && x + i < w; i++) if (covered[base + x + i]) { ok |= 2; break; }
        if (!(ok & 2)) return false;
        for (i = 1; i <= vLim && y + i < h; i++) if (covered[(y + i) * w + x]) { ok |= 4; break; }
        return ok === 7;
      }
      var nSkin = 0, skinFilled = new Uint8Array(w * h);
      for (var y2 = top; y2 <= bot; y2++) {
        for (var x2 = 0; x2 < w; x2++) {
          var p2 = y2 * w + x2;
          if (!reveal[p2]) continue;
          var isLeg = legHem != null && y2 > legHem + 2;
          var core = body.rows[y2];
          var outOfTorso = !core || core.cx0 < 0 || x2 < core.cx0 - 1 || x2 > core.cx1 + 1;
          var isArm = sleeveEnd != null && y2 > sleeveEnd + 2 && outOfTorso;
          /* (다) **새 옷이 만든 구멍** — 목선·앞여밈처럼 옷에 둘러싸인 빈 자리.
           * 확산에 맡기면 원래 옷 색이 그 안으로 번져, 브이넥 자리에
           * 회청색 쐐기가 어깨를 가로질러 앉는다(아우터 전부가 그랬다).
           * 구멍인지 아닌지는 추정하지 않고 **둘러싸여 있는지**로 본다 —
           * 좌·우·아래 모두 가까이에 새 옷이 있으면 그건 옷의 구멍이다.
           * 어깨에 내려온 머리카락은 위가 뚫려 있으므로 걸리지 않는다. */
          var isNeck = !isLeg && !isArm && y2 < waistLine && enclosed(x2, y2);
          if (!isLeg && !isArm && !isNeck) continue;
          /* 구멍 안에 무엇을 둘까.
           * 아우터는 **겹쳐 입는 옷**이다. 재킷의 여밈 사이로는 원래 입고
           * 있던 옷이 보이는 것이 맞다 — 지어내지 않고 사진을 그대로 둔다.
           * 상의·원피스는 겹쳐 입는 것이 아니므로 그 자리는 피부다. */
          if (isNeck && hasOuter) { known[p2] = 1; reveal[p2] = 0; nRev--; continue; }
          var lf2 = clamp(body.light[p2] / lmeanB, 0.68, 1.34);
          var i3 = p2 * 4;
          od[i3]     = clamp(skinRGB.r * lf2, 0, 255);
          od[i3 + 1] = clamp(skinRGB.g * lf2, 0, 255);
          od[i3 + 2] = clamp(skinRGB.b * lf2, 0, 255);
          reveal[p2] = 0; known[p2] = 1; skinFilled[p2] = 1; nRev--; nSkin++;
        }
      }
      // 피부로 칠한 자리의 경계만 살짝 뭉갠다.
      // 예전에는 "밴드 안의 알려진 픽셀"을 넘겼는데 그건 사실상 옷 전체였고,
      // 그래서 옷이 통째로 뿌옇게 흐려졌다.
      if (nSkin) smoothRegion(od, w, h, skinFilled, 1);

      /* 확산의 출처는 **인물 안쪽의 알려진 픽셀**뿐이다.
       * 배경까지 출처로 삼으면 실루엣 가장자리의 드러난 부분이 배경색으로
       * 채워져 다리가 허옇게 뜬다 — 실제로 그렇게 나왔다. */
      for (var q = 0; q < w * h; q++) {
        known[q] = (!reveal[q] && body.mask[q] && (covered[q] || body.skin[q])) ? 1 : 0;
      }
      var total = Math.max(1, countMask(body.mask));
      report.skinRatio = nSkin / total;
      if (nRev > 0) {
        nearestFill(od, w, h, known, reveal);
        report.revealRatio = nRev / total;
        if (nRev / total > 0.045) {
          report.warnings.push('원래 입은 옷이 새 옷보다 커서 드러난 부분(' +
            (nRev / total * 100).toFixed(0) + '%)을 주변 색으로 메웠습니다. ' +
            '몸에 붙는 옷을 입고 찍으면 사라집니다.');
        }
      } else {
        report.revealRatio = 0;
      }
      if (nSkin / total > 0.02) {
        report.warnings.push('새 옷이 원래 옷보다 짧아 드러난 팔·다리(' +
          (nSkin / total * 100).toFixed(0) + '%)를 얼굴에서 잰 피부색으로 그렸습니다. ' +
          '실제 팔·다리의 음영이나 형태가 아닙니다.');
      }
    }

    return { imageData: out, report: report };
  }

  function countMask(m) { var n = 0; for (var i = 0; i < m.length; i++) if (m[i]) n++; return n; }

  function applyLayer(body, layer, od, covered, gopts) {
    var spec = GARMENTS.byId(layer.garmentId);
    if (!spec) return null;
    var G = GARMENTS.get(layer.garmentId);
    if (!G) return null;

    var w = body.w, h = body.h;
    var gcv = G.canvas, gw = gcv.width, gh = gcv.height;

    /* --- 색 변환 (캐시) ---
     * 여유분·기장·빛 슬라이더를 움직여도 옷의 색은 그대로다. 그런데 색 변환이
     * 합성 시간의 대부분을 차지하므로, 캐시가 없으면 슬라이더를 잡는 동안
     * 화면이 끊긴다. 색과 관련된 값이 바뀔 때만 다시 계산한다. */
    var tinted = tintCached(layer, spec, G, gw, gh);
    var gimg = tinted.imageData, recolorInfo = tinted.info;
    var gd = gimg.data;

    /* --- 대응점 : 몸통 / 왼소매 / 오른소매 --- */
    var aopts = layer.opts || gopts || {};
    if (gopts && gopts.view && gopts.view.halfAt && !aopts.halfAt) {
      aopts = Object.assign({}, aopts, { halfAt: gopts.view.halfAt });
    }
    var anchors = bodyAnchors(body, spec, aopts, G);
    if (!anchors) return null;
    var parts = buildParts(spec, G, anchors);
    if (!parts.length) return null;

    /* --- 넘침 허용 : 오버사이즈 옷은 원래 실루엣 밖으로 나가야 한다 ---
     * 반경별로 캐시한다. 슬라이더를 잡고 있는 동안 같은 마스크를 매번 다시
     * 만들면 그 비용이 합성 시간의 상당 부분을 차지한다. */
    /* 옷이 사람 실루엣 밖으로 나갈 수 있는 여유.
     *
     * 이 값이 짧은 변의 1.2%(450px 사진에서 **5픽셀**)로 고정돼 있었다.
     * 그런데 body.mask 는 맨몸이 아니라 **그때 입고 있던 옷까지 포함한**
     * 실루엣이다. 그러니 원래 옷보다 조금이라도 넉넉한 옷은 전부 그 윤곽에
     * 눌려 들어갔다 — 오버핏이 오버핏으로 안 보이고, 여유분 슬라이더를
     * 끝까지 올려도 폭이 안 늘고, 반입한 옷의 어깨를 밖으로 끌어도
     * 아무 일도 일어나지 않았다.
     *
     * 넉넉한 정도(옷의 재단 × 사용자가 고른 여유분)만큼 열어 준다. */
    var roomy = (spec.fit || 1) * (gopts.ease == null ? 1 : gopts.ease);
    var over = Math.round(Math.min(w, h) * 0.012 * clamp(1 + (roomy - 1) * 6, 1, 4.5));
    if (!body._allow) body._allow = {};
    var allow = body._allow[over] || (body._allow[over] = dilate(body.mask, w, h, over));
    /* 소매는 넘침을 허용하지 않는다.
     * 몸통은 오버핏일 때 실루엣 밖으로 나가는 게 맞지만, 소매까지 나가면
     * 팔 옆 허공에 천 조각이 떠 있는 것처럼 보인다 — 확대해 보니 실제로
     * 어깨패드 같은 덩어리가 배경 위에 얹혀 있었다. */
    var allowTight = body.mask;

    /* --- 조명장 정규화 : 이 옷이 놓일 영역의 평균 밝기를 1로 --- */
    var lmean = meanLightOver(body, allow, anchors);
    var lightAmt = gopts && gopts.lightAmount != null ? gopts.lightAmount : 0.75;
    var neckY = anchors._neckY != null ? anchors._neckY : -1;

    /* ── 원통 감기 준비 ──
     * 옷본 좌표를 몸의 단면 형상에 맞춰 다시 배치한다. 옆모습에서 잰
     * 두께가 있으면 그 값을, 없으면 기본 비율을 쓴다. */
    var view = (gopts && gopts.view) || null;
    var yawDeg = view && view.yaw != null ? view.yaw : 0;
    var wrapAmt = gopts && gopts.wrap != null ? gopts.wrap : 1;
    var gHalfFn = wrapAmt > 0.01 ? garmentHalfFn(G, spec) : null;
    var gcxW = G.geom.cx;
    var yawRad = yawDeg * Math.PI / 180;
    var depthAt = view && view.depthRatioAt
      ? view.depthRatioAt
      : function () { return DEFAULT_DEPTH_RATIO; };
    // 높이(몸 좌표)를 어깨=0 · 밑단=1 로 정규화해 두께 비를 읽는다
    var wTop = anchors._shY != null ? anchors._shY : anchors._topY;
    var wBot = anchors._hemY != null ? anchors._hemY : (wTop + 1);
    var wSpan = Math.max(1, wBot - wTop);

    /* 조각끼리 겹치는 진동(어깨) 부근을 두 번 칠하지 않게 한다 */
    var done = new Uint8Array(w * h);
    var s4 = new Float32Array(4), uv = new Float32Array(2);
    var nPix = 0;

    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi];
      var fn = solveTPS(part.dst, part.src, 8e-4);
      if (!fn) continue;

      var pad = Math.round(Math.min(w, h) * 0.06);
      var xs = part.dst.map(function (q) { return q[0]; });
      var ys = part.dst.map(function (q) { return q[1]; });
      var bx0 = clamp(Math.floor(Math.min.apply(null, xs)) - pad, 0, w - 1);
      var bx1 = clamp(Math.ceil(Math.max.apply(null, xs)) + pad, 0, w - 1);
      var by0 = clamp(Math.floor(Math.min.apply(null, ys)) - pad, 0, h - 1);
      var by1 = clamp(Math.ceil(Math.max.apply(null, ys)) + pad, 0, h - 1);
      var field = warpField(fn, bx0, by0, bx1, by1, 5);
      var test = part.test, clampFn = part.clampFn;
      var bound = part.bound || null, xspan = part.xspan || null;
      var partAllow = part.tight ? allowTight : allow;

      for (var y = by0; y <= by1; y++) {
        for (var x = bx0; x <= bx1; x++) {
          var p = y * w + x;
          if (!partAllow[p] || done[p]) continue;
          if (xspan) {
            var xr = xspan(y);
            if (!xr || x < xr[0] || x > xr[1]) continue;
          }
          if (bound) {
            var bq = bound.halfAt(y);
            var off = Math.abs(x - bq.cx);
            /* 몸통 조각은 **맨팔을 침범하지 않는다.**
             * 인물 분리가 좋아지면서 팔이 몸통과 한 덩어리로 잡히자,
             * 몸통이 팔까지 덮어 반팔 티셔츠가 판초처럼 보였다.
             * 옷본 폭 바깥의 피부는 팔이므로 소매(먼저 그려진다)에 맡기고
             * 몸통은 손대지 않는다. 안쪽 피부(맨 상체)는 덮는 것이 맞다. */
            if (off > bq.half * 1.02 && body.skin[p]) continue;
            var kk = y <= (anchors.armL ? anchors.armL[1] : 1e9) + 2 ? 1.55 : 1.12;
            if (off > bq.half * kk + 2) continue;
          }

          /* 얼굴·목은 절대 덮지 않는다 — 이 도구의 전부인 얼굴색이 가려진다 */
          if (body.skin[p] && neckY >= 0 && y < neckY + 2) continue;

          field(x, y, uv);

          /* 몸통에만 원통 감기를 적용한다. 소매는 팔이라는 훨씬 가는
           * 원기둥이라 같은 식을 쓰면 과하게 눌린다. */
          if (gHalfFn && part.wrap) {
            var hg = gHalfFn(uv[1]);
            if (hg > 1) {
              var tt = (uv[0] - gcxW) / hg;
              if (tt > -1.6 && tt < 1.6) {
                var br = depthAt(clamp((y - wTop) / wSpan, 0, 1));
                var dl = Math.atan2(br * Math.sin(yawRad), Math.cos(yawRad));
                var uw = wrapU(tt, dl);
                uv[0] = gcxW + (uw * wrapAmt + tt * (1 - wrapAmt)) * hg;
              }
            }
          }

          // 이 조각이 맡은 옷본 영역으로 좌표를 정리한다.
          // 소매는 벗어나면 버리고(정확도 우선), 몸통은 잘라서 읽는다(구멍 방지).
          if (clampFn) clampFn(uv);
          else if (test && !test(uv[0], uv[1])) continue;
          if (!sampleRGBA(gd, gw, gh, uv[0], uv[1], s4)) continue;
          // 실루엣 가장자리를 반화소로 녹인다 — 톱니의 원인을 여기서 없앤다
          var a = (s4[3] / 255) * (body.edge ? body.edge[p] : 1);
          if (a < 0.004) continue;

          /* 사진의 빛을 옷에 이식한다 */
          var lf = clamp(1 + (body.light[p] / lmean - 1) * lightAmt, 0.62, 1.42);
          var i2 = p * 4;
          od[i2]     = od[i2]     * (1 - a) + clamp(s4[0] * lf, 0, 255) * a;
          od[i2 + 1] = od[i2 + 1] * (1 - a) + clamp(s4[1] * lf, 0, 255) * a;
          od[i2 + 2] = od[i2 + 2] * (1 - a) + clamp(s4[2] * lf, 0, 255) * a;
          if (a > 0.55) { covered[p] = 1; done[p] = 1; nPix++; }
        }
      }
    }

    return {
      id: layer.garmentId, ko: spec.ko, cat: spec.cat,
      colorHex: layer.colorHex || null,
      anchors: anchors, recolor: recolorInfo, pixels: nPix
    };
  }

  /** 옷이 놓일 자리의 평균 밝기 — 조명장을 1 기준으로 맞추는 데 쓴다 */
  function meanLightOver(body, allow, anchors) {
    var w = body.w, h = body.h;
    var y0 = clamp(Math.round(anchors._topY == null ? 0 : anchors._topY), 0, h - 1);
    var y1 = clamp(Math.round(anchors._hemY == null ? h - 1 : anchors._hemY), 0, h - 1);
    var sum = 0, n = 0;
    for (var y = y0; y <= y1; y += 2) {
      for (var x = 0; x < w; x += 2) {
        var p = y * w + x;
        if (allow[p]) { sum += body.light[p]; n++; }
      }
    }
    return n ? sum / n : 128;
  }

  /* --- 색 변환 결과 캐시 : 키가 같으면 다시 계산하지 않는다 --- */
  var _tintCache = [], TINT_MAX = 24;

  function garmentSource(G, gw, gh) {
    if (!G._srcImg) {
      G._srcImg = G.canvas.getContext('2d').getImageData(0, 0, gw, gh);
      var m = new Uint8Array(gw * gh);
      for (var i = 0, p = 0; i < G._srcImg.data.length; i += 4, p++) {
        m[p] = G._srcImg.data[i + 3] > 8 ? 1 : 0;
      }
      G._srcMask = m;
    }
    return G;
  }

  function tintCached(layer, spec, G, gw, gh) {
    garmentSource(G, gw, gh);
    if (!layer.colorHex) return { imageData: G._srcImg, info: null };

    var key = [layer.garmentId, layer.colorHex, layer.material || spec.material,
               layer.cluster == null ? '-' : layer.cluster, layer.mode || 'single',
               layer.strength == null ? 1 : layer.strength].join('|');
    for (var i = 0; i < _tintCache.length; i++) {
      if (_tintCache[i].key === key) {
        var hit = _tintCache.splice(i, 1)[0];
        _tintCache.push(hit);                     // 최근 사용으로 옮긴다 (LRU)
        return hit;
      }
    }

    var work = new ImageData(gw, gh);
    work.data.set(G._srcImg.data);
    var rc = RECOLOR.recolor(work, G._srcMask, gw, gh, layer.colorHex, {
      material: layer.material || spec.material,
      cluster: layer.cluster, mode: layer.mode || 'single',
      strength: layer.strength == null ? 1 : layer.strength
    });
    var entry = {
      key: key, imageData: rc.imageData,
      info: {
        clusters: rc.clusters, material: rc.material,
        verify: RECOLOR.verify(G._srcImg, rc.imageData, G._srcMask, gw, gh, layer.colorHex)
      }
    };
    _tintCache.push(entry);
    if (_tintCache.length > TINT_MAX) _tintCache.shift();
    return entry;
  }

  /* =======================================================================
   * 6. 진단 결과 → 추천 색 : 피팅과 퍼스널 컬러를 잇는 지점
   *
   * 이 기능이 단순한 옷 갈아입히기와 다른 이유가 여기 있다. 색은 임의로
   * 고르는 것이 아니라 **앞에서 판정한 팔레트**에서 나오고, 얼굴에서
   * 먼 옷일수록 자유도를 높인다(리포트의 색 배치 전략과 같은 규칙).
   * ===================================================================== */
  function paletteFor(dx, rec, cat) {
    var strat = rec && rec.colorStrategy ? rec.colorStrategy : null;
    var pal = (dx && dx.type && dx.type.palette) ? dx.type.palette : [];
    function take(list) {
      return (list || []).map(function (c) {
        return { hex: c.hex, ko: c.ko || c.name || '', role: c.role || '' };
      });
    }
    if (strat) {
      if (cat === 'top' || cat === 'dress' || cat === 'outer') {
        return take(strat.hero).concat(take(strat.soft)).concat(take(strat.base));
      }
      /* 하의는 **베이스(뉴트럴)를 먼저** 보여준다.
       * "얼굴에서 멀어 자유롭다"는 말은 아무 색이나 좋다는 뜻이 아니라
       * 팔레트 밖 색도 쓸 수 있다는 뜻이다. 조화 점수 1위를 그대로 첫 색으로
       * 쓰면 형광 초록 바지가 기본값이 된다 — 실제로 그렇게 나왔다.
       * 리포트의 "베이스 70% · 보조 25% · 포인트 5%" 규칙과도 이 순서가 맞다. */
      return take(strat.base).concat(take(strat.bottomFriendly)).concat(take(strat.hero));
    }
    return take(pal);
  }

  global.TRYON = {
    prepare: prepare, compose: compose, bodyAnchors: bodyAnchors,
    solveTPS: solveTPS, warpField: warpField, paletteFor: paletteFor,
    HEM_BODY: HEM_BODY, KEYS_TOP: KEYS_TOP, KEYS_BOTTOM: KEYS_BOTTOM,
    saneLM: saneLM, silhouetteLM: silhouetteLM, buildParts: buildParts, limbEdges: limbEdges,
    wrapU: wrapU, garmentHalfFn: garmentHalfFn, DEFAULT_DEPTH_RATIO: DEFAULT_DEPTH_RATIO,
    clearTintCache: function () { _tintCache = []; }
  };
})(window);
