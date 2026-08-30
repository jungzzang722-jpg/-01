/* 반입 경로용 픽스처 — 실제 상품컷을 닮은 평면 촬영 이미지.
 *
 * 절차적 카탈로그의 옷본과 상품컷의 결정적 차이는 **소매를 양옆으로 펼쳐
 * 놓는다**는 것이다. 그래서 상품컷은 세로보다 가로가 길고, 어깨 높이의
 * 행 폭이 어깨가 아니라 펼친 소매 폭이 된다. 이 차이가 반입한 옷에서
 * 어깨 날개를 만든다는 것이 가설이고, 이 픽스처가 그것을 재현한다.
 *
 * 사진처럼 보이게 하는 요소도 넣는다 — 알고리즘이 실제로 걸려 넘어지는
 * 것들이다: 완전 흰색이 아닌 배경, 옷 주변의 옅은 그림자, 반화소 가장자리,
 * 천의 결과 얼룩.
 */
(function (global) {
  'use strict';

  function mkCanvas(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }

  /** 배경 — 상품컷은 순백이 아니라 아주 옅은 회색에 가깝다 */
  function background(c, w, h) {
    c.fillStyle = '#fdfdfd';
    c.fillRect(0, 0, w, h);
  }

  /** 옷 밑에 깔리는 옅은 그림자 — 분리 알고리즘이 실제로 만나는 것 */
  function softShadow(c, path, dx, dy, blur) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.16)';
    c.shadowBlur = blur; c.shadowOffsetX = dx; c.shadowOffsetY = dy;
    c.fillStyle = 'rgba(0,0,0,0.9)';
    c.fill(path);
    c.restore();
  }

  /** 결 — 방향성 있는 잡음. 데님의 능직, 코듀로이의 골, 기모의 보풀. */
  function weave(c, w, h, kind, seed) {
    var im = c.getImageData(0, 0, w, h), d = im.data;
    var s = seed || 1;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (d[i + 3] < 8) continue;
        var n = 0;
        if (kind === 'denim') n = ((x + y) % 3 === 0 ? 5 : -3) + (rnd() - 0.5) * 9;
        else if (kind === 'cord') n = Math.sin(x * 0.42) * 13 + (rnd() - 0.5) * 5;
        else n = (rnd() - 0.5) * 13;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
    }
    c.putImageData(im, 0, 0);
  }

  /** 위에서 아래로 아주 옅게 어두워지는 촬영 조명 */
  function studioLight(c, w, h) {
    var g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.09)');
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
  }

  /* ── 데님 재킷 ────────────────────────────────────────────────────
   * 소매를 좌우로 활짝 펼친 전형적인 상품컷. 가로 1404 × 세로 1131 —
   * 세로보다 가로가 길다는 점이 절차적 옷본과 가장 다른 지점이다. */
  function denimJacket() {
    var W = 1404, H = 1131, cv = mkCanvas(W, H), c = cv.getContext('2d');
    background(c, W, H);
    var cx = W / 2;

    var body = new Path2D();
    body.moveTo(cx - 285, 175);           // 왼 어깨
    body.lineTo(cx - 320, 470);
    body.lineTo(cx - 330, 900);
    body.lineTo(cx - 325, 1000);          // 밑단 왼쪽
    body.lineTo(cx + 325, 1000);
    body.lineTo(cx + 330, 900);
    body.lineTo(cx + 320, 470);
    body.lineTo(cx + 285, 175);           // 오른 어깨
    body.closePath();

    // 소매 — 어깨에서 바깥·아래로. 소맷부리가 이미지의 좌우 끝이다.
    function sleeve(sign) {
      var p = new Path2D();
      p.moveTo(cx + sign * 280, 180);
      p.lineTo(cx + sign * 690, 720);     // 바깥 위
      p.lineTo(cx + sign * 682, 930);     // 소맷부리 바깥
      p.lineTo(cx + sign * 545, 940);     // 소맷부리 안
      p.lineTo(cx + sign * 335, 560);     // 겨드랑이
      p.lineTo(cx + sign * 318, 430);
      p.closePath();
      return p;
    }
    var sL = sleeve(-1), sR = sleeve(1);

    // 칼라 — 어깨선 위로 올라온다
    var collar = new Path2D();
    collar.moveTo(cx - 105, 205);
    collar.lineTo(cx - 128, 40);
    collar.lineTo(cx + 128, 40);
    collar.lineTo(cx + 105, 205);
    collar.closePath();

    [sL, sR, body, collar].forEach(function (p) { softShadow(c, p, 6, 12, 22); });

    c.fillStyle = '#3f5a7e';
    c.fill(sL); c.fill(sR); c.fill(body);
    c.fillStyle = '#3a5375'; c.fill(collar);

    // 솔기와 디테일 — 분리에는 영향이 없지만 사진처럼 보이게 한다
    c.strokeStyle = 'rgba(214,178,110,0.55)'; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx, 210); c.lineTo(cx, 1000);                       // 앞여밈
    c.moveTo(cx - 300, 360); c.lineTo(cx + 300, 360);            // 요크
    c.moveTo(cx - 325, 930); c.lineTo(cx + 325, 930);            // 밑단 밴드
    c.stroke();
    [[-170, 400], [170, 400]].forEach(function (q) {             // 가슴 주머니
      c.strokeRect(cx + q[0] - 78, q[1], 156, 130);
    });

    weave(c, W, H, 'denim', 7);
    studioLight(c, W, H);
    return { canvas: cv, ko: '데님 재킷', cat: 'top', material: 'denim' };
  }

  /* ── 코듀로이 팬츠 ────────────────────────────────────────────────
   * 세로가 긴 상품컷. 두 다리가 가랑이 아래에서 갈라진다. */
  function cordPants() {
    var W = 1131, H = 1404, cv = mkCanvas(W, H), c = cv.getContext('2d');
    background(c, W, H);
    var cx = W / 2;

    var p = new Path2D();
    p.moveTo(cx - 275, 30);               // 허리 왼쪽
    p.lineTo(cx - 300, 330);
    p.lineTo(cx - 330, 900);
    p.lineTo(cx - 345, 1370);             // 왼 밑단 바깥
    p.lineTo(cx - 148, 1372);             // 왼 밑단 안
    p.lineTo(cx - 62, 900);
    c.save();
    p.lineTo(cx - 18, 470);                // 가랑이
    p.lineTo(cx + 18, 470);
    p.lineTo(cx + 62, 900);
    p.lineTo(cx + 148, 1372);
    p.lineTo(cx + 345, 1370);
    p.lineTo(cx + 330, 900);
    p.lineTo(cx + 300, 330);
    p.lineTo(cx + 275, 30);
    p.closePath();
    c.restore();

    softShadow(c, p, 6, 12, 22);
    c.fillStyle = '#8a5a2c'; c.fill(p);

    c.strokeStyle = 'rgba(60,36,16,0.45)'; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx - 278, 92); c.lineTo(cx + 278, 92);              // 허리 밴드
    c.moveTo(cx, 96); c.lineTo(cx, 300);                          // 앞선
    c.stroke();

    weave(c, W, H, 'cord', 13);
    studioLight(c, W, H);
    return { canvas: cv, ko: '코듀로이 팬츠', cat: 'bottom', material: 'cotton' };
  }

  /* ── 후드 티셔츠 ──────────────────────────────────────────────────
   * 후드가 어깨선 위로 크게 올라온다 — measureTop 의 "목·후드" 분기를
   * 실제로 타는 경우다. */
  function hoodie() {
    var W = 1404, H = 1131, cv = mkCanvas(W, H), c = cv.getContext('2d');
    background(c, W, H);
    var cx = W / 2;

    var body = new Path2D();
    body.moveTo(cx - 300, 250);
    body.lineTo(cx - 330, 560);
    body.lineTo(cx - 340, 940);
    body.lineTo(cx - 335, 1035);
    body.lineTo(cx + 335, 1035);
    body.lineTo(cx + 340, 940);
    body.lineTo(cx + 330, 560);
    body.lineTo(cx + 300, 250);
    body.closePath();

    function sleeve(sign) {
      var p = new Path2D();
      p.moveTo(cx + sign * 296, 255);
      p.lineTo(cx + sign * 688, 790);
      p.lineTo(cx + sign * 676, 1000);
      p.lineTo(cx + sign * 552, 1010);
      p.lineTo(cx + sign * 345, 640);
      p.lineTo(cx + sign * 330, 500);
      p.closePath();
      return p;
    }
    var sL = sleeve(-1), sR = sleeve(1);

    var hood = new Path2D();
    hood.moveTo(cx - 240, 300);
    hood.bezierCurveTo(cx - 250, 70, cx + 250, 70, cx + 240, 300);
    hood.closePath();

    [sL, sR, hood, body].forEach(function (p) { softShadow(c, p, 6, 12, 22); });
    c.fillStyle = '#b9babd';
    c.fill(sL); c.fill(sR); c.fill(hood); c.fill(body);

    // 후드 안쪽 그늘 + 캥거루 주머니 + 립
    c.fillStyle = 'rgba(120,122,126,0.55)';
    c.beginPath(); c.ellipse(cx, 235, 132, 66, 0, 0, 7); c.fill();
    c.strokeStyle = 'rgba(120,122,126,0.6)'; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx - 210, 700); c.lineTo(cx - 175, 900); c.lineTo(cx + 175, 900);
    c.lineTo(cx + 210, 700);
    c.moveTo(cx - 335, 950); c.lineTo(cx + 335, 950);
    c.stroke();

    weave(c, W, H, 'fleece', 29);
    studioLight(c, W, H);
    return { canvas: cv, ko: '후드 티셔츠', cat: 'top', material: 'knit' };
  }

  global.GARMENT_FIXTURE = {
    denimJacket: denimJacket, cordPants: cordPants, hoodie: hoodie,
    all: function () { return [denimJacket(), cordPants(), hoodie()]; }
  };
})(window);
