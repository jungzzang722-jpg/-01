/* =========================================================================
 * garments.js — 의류 이미지 데이터베이스 (내장 카탈로그 + 사용자 반입)
 *
 * "실제 옷 사진"을 이 파일에 넣을 수 없는 이유는 기술이 아니라 권리다.
 * 쇼핑몰 상품컷은 전부 저작물이고, 공개 데이터셋(VITON-HD·DressCode·
 * DeepFashion)은 연구 목적 라이선스라 배포본에 담을 수 없다. 그렇다고
 * 벡터 일러스트로 대체하면 "옷을 입어봤다"는 느낌이 나오지 않는다 —
 * 사람이 옷을 사진으로 인식하는 근거는 실루엣이 아니라 **직물의 결과
 * 주름 음영**이기 때문이다.
 *
 * 그래서 이 파일은 옷을 **그리지 않고 합성한다.**
 *   실루엣(패턴) + 소재별 직조 텍스처 + 드레이프 주름 + 가장자리 AO
 *   + 봉제선·단추·리브 = 래스터 이미지
 * 결과물은 알파를 가진 RGBA 캔버스이며, 아래 피팅 엔진 입장에서는
 * 사용자가 반입한 실제 상품컷과 **완전히 동일한 자료형**이다.
 *
 * 실제 옷 사진을 쓰고 싶으면 사용자가 직접 넣는다(importPhoto).
 * 배경을 자동으로 지우고 앵커를 추정해 IndexedDB에 저장하므로,
 * 한 번 넣은 옷은 다음에 열어도 그대로 있다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var clamp = CC.clamp;

  /* =======================================================================
   * 1. 난수 · 노이즈 — 같은 옷은 항상 같은 결로 나와야 한다(시드 고정)
   * ===================================================================== */
  function rngFrom(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /** 값 노이즈 격자 — 보간해 부드러운 얼룩을 만든다 */
  function valueNoise(w, h, cell, rand) {
    var gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    var g = new Float32Array(gw * gh);
    for (var i = 0; i < g.length; i++) g[i] = rand();
    return function (x, y) {
      var fx = x / cell, fy = y / cell;
      var x0 = Math.floor(fx), y0 = Math.floor(fy);
      var tx = fx - x0, ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      var a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1];
      var c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
  }

  /** 여러 옥타브를 겹쳐 자연스러운 밀도 */
  function fbm(w, h, cell, oct, rand) {
    var layers = [], amp = 1, sum = 0, c = cell;
    for (var i = 0; i < oct; i++) {
      layers.push({ n: valueNoise(w, h, Math.max(2, c), rand), a: amp });
      sum += amp; amp *= 0.5; c *= 0.5;
    }
    return function (x, y) {
      var v = 0;
      for (var i = 0; i < layers.length; i++) v += layers[i].n(x, y) * layers[i].a;
      return v / sum;
    };
  }

  /* =======================================================================
   * 2. 소재 — 재질마다 빛에 반응하는 방식이 다르다
   *
   * weave    직조 무늬 종류
   * grain    표면 거칠기 (음영 진폭)
   * fold     주름의 깊이 — 니트는 무겁게 늘어지고 린넨은 각지게 꺾인다
   * foldFreq 주름 간격
   * spec     정반사(광택) 세기 — 실크·레더는 하이라이트가 살아 있다
   * specW    하이라이트 폭
   * ao       가장자리 음영 세기
   * sheen    전체적인 빛 번짐
   * ===================================================================== */
  var MATERIALS = {
    cotton:  { ko: '면',        weave: 'plain',  grain: .030, fold: .085, foldFreq: 3.0, spec: .05, specW: .35, ao: .30, sheen: .02 },
    jersey:  { ko: '저지',      weave: 'plain',  grain: .022, fold: .105, foldFreq: 2.4, spec: .04, specW: .40, ao: .32, sheen: .03 },
    knit:    { ko: '니트',      weave: 'rib',    grain: .055, fold: .120, foldFreq: 1.9, spec: .03, specW: .45, ao: .38, sheen: .01 },
    wool:    { ko: '울',        weave: 'twill',  grain: .045, fold: .095, foldFreq: 2.1, spec: .04, specW: .40, ao: .35, sheen: .02 },
    denim:   { ko: '데님',      weave: 'denim',  grain: .062, fold: .135, foldFreq: 2.6, spec: .06, specW: .30, ao: .34, sheen: .02 },
    linen:   { ko: '린넨',      weave: 'linen',  grain: .058, fold: .150, foldFreq: 3.4, spec: .05, specW: .28, ao: .30, sheen: .02 },
    silk:    { ko: '실크',      weave: 'satin',  grain: .012, fold: .165, foldFreq: 2.0, spec: .34, specW: .22, ao: .26, sheen: .09 },
    leather: { ko: '레더',      weave: 'grainy', grain: .038, fold: .075, foldFreq: 1.7, spec: .30, specW: .18, ao: .40, sheen: .06 },
    tweed:   { ko: '트위드',    weave: 'tweed',  grain: .085, fold: .080, foldFreq: 2.2, spec: .03, specW: .42, ao: .36, sheen: .01 },
    corduroy:{ ko: '코듀로이',  weave: 'wale',   grain: .050, fold: .090, foldFreq: 2.0, spec: .08, specW: .25, ao: .36, sheen: .03 },
    tech:    { ko: '기능성',    weave: 'plain',  grain: .018, fold: .070, foldFreq: 2.8, spec: .16, specW: .26, ao: .30, sheen: .05 }
  };

  /* =======================================================================
   * 3. 실루엣 패턴 — 옷본(pattern)에 해당한다
   * ===================================================================== */
  var BASE_W = 512, BASE_H = 660;
  // 렌더 중에만 바뀌는 작업 해상도. 썸네일은 1/4로 그려야 40벌을 즉시 띄울 수 있다.
  // (모든 좌표를 W·H의 비율로 쓴 덕분에 배율만 바꾸면 형태가 그대로 따라온다)
  var W = BASE_W, H = BASE_H;

  /** Catmull-Rom → 베지어. 옷의 곡선은 직선으로 그리면 종이인형이 된다. */
  function smoothPath(ctx, pts, tension) {
    tension = tension == null ? 0.5 : tension;
    var n = pts.length;
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i],
          p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      ctx.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6 * tension, p1[1] + (p2[1] - p0[1]) / 6 * tension,
        p2[0] - (p3[0] - p1[0]) / 6 * tension, p2[1] - (p3[1] - p1[1]) / 6 * tension,
        p2[0], p2[1]
      );
    }
    ctx.closePath();
  }

  var NECK = {
    crew:  { half: .105, drop: .028, ko: '라운드넥' },
    v:     { half: .115, drop: .105, ko: '브이넥' },
    deepv: { half: .130, drop: .155, ko: '깊은 브이넥' },
    shirt: { half: .120, drop: .045, ko: '셔츠칼라' },
    turtle:{ half: .098, drop: .002, ko: '터틀넥' },
    boat:  { half: .175, drop: .022, ko: '보트넥' },
    square:{ half: .150, drop: .075, ko: '스퀘어넥' }
  };

  /* ── 해부학 사다리 ──────────────────────────────────────────────────
   * 옷본의 세로 좌표와 몸의 세로 좌표가 **같은 비율 체계**를 써야 한다.
   * 그러지 않으면 TPS가 옷의 한 구간을 몸의 다른 길이로 억지로 늘이며
   * 소매가 접히고 밑단이 말려 올라간다. 실제로 그렇게 망가졌었다.
   *
   * 상의 캔버스의 세로축은 [어깨 … 무릎기장 밑단]을 나타낸다.
   * 아래 값은 성인 표준 비율에서 그 구간을 정규화해 얻은 것이며,
   * tryon.js의 HEM_BODY·SLEEVE_BODY가 몸에서 정확히 같은 지점을 가리킨다.
   *   어깨 .085 · 겨드랑이 .232 · 허리 .432 · 골반 .593 · 손목 .784
   * ------------------------------------------------------------------ */
  var HEM_Y = { crop: .335, waist: .445, hip: .633, thigh: .772, knee: .950 };

  /* 하의 캔버스의 세로축은 [허리 … 발목]이다. 상의와 기준점이 다르므로
   * 표를 따로 둔다 — 같은 'knee'라도 두 캔버스에서 위치가 다르다. */
  var HEM_Y_B = { thigh: .437, knee: .642, midi: .800, ankle: .965 };

  /**
   * 상의·아우터·원피스의 외곽선과 앵커를 함께 만든다.
   * 앵커를 그림에서 따로 재지 않고 **패턴을 만든 수치 그대로** 내보내는 것이
   * 중요하다 — 따로 재면 실루엣과 앵커가 서서히 어긋난다.
   */
  function topOutline(g) {
    var cx = W / 2;
    var fit = g.fit == null ? 1 : g.fit;            // .88 슬림 ~ 1.22 오버
    var nk = NECK[g.neck] || NECK.crew;
    var neckHalf = nk.half * W * (g.neckWide || 1);
    var neckY = nk.drop * H + H * .045;
    var shY = H * .085;
    var shHalf = (g.shoulderHalf || .285) * W * fit;
    var armpitY = H * (g.armpitY || .232);
    var bodyHalf = (g.bodyHalf || .255) * W * fit;
    var waistHalf = bodyHalf * (g.waistIn == null ? .96 : g.waistIn);
    var hemY = H * (HEM_Y[g.hem] || HEM_Y.hip);
    var hemHalf = bodyHalf * (g.hemOut == null ? 1.02 : g.hemOut);

    /* 소매 끝도 같은 사다리 위에 있다 — 손목 .784, 팔꿈치 .432 */
    var sleeve = g.sleeve || 'long';
    var cuffY, cuffOut, cuffIn, cuffInY;
    if (sleeve === 'long')       { cuffY = H * .784; cuffOut = shHalf + W * .105; cuffIn = shHalf + W * .022; cuffInY = H * .752; }
    else if (sleeve === 'threeq'){ cuffY = H * .655; cuffOut = shHalf + W * .095; cuffIn = shHalf + W * .012; cuffInY = H * .625; }
    else if (sleeve === 'short') { cuffY = H * .315; cuffOut = shHalf + W * .062; cuffIn = shHalf + W * .002; cuffInY = H * .290; }
    else if (sleeve === 'cap')   { cuffY = H * .205; cuffOut = shHalf + W * .020; cuffIn = shHalf - W * .010; cuffInY = H * .196; }
    else                         { cuffY = armpitY;  cuffOut = shHalf * .90;      cuffIn = shHalf * .88;      cuffInY = armpitY; }

    /* 소맷부리가 겨드랑이보다 위면(캡 소매) 소매라 할 구간이 없다.
     * 그때는 별도 조각을 만들지 않고 몸통 요크의 일부로 다룬다. */
    var hasSleeve = sleeve !== 'none' && cuffY > armpitY * 1.05;
    var midSleeveY = armpitY + (cuffY - armpitY) * 0.5;

    var pts = [];
    pts.push([cx - neckHalf, neckY]);
    pts.push([cx - shHalf * .70, shY + H * .006]);
    pts.push([cx - shHalf, shY]);                                   // 왼 어깨끝
    pts.push([cx - cuffOut, cuffY]);                                // 왼 소매 바깥
    pts.push([cx - cuffIn, cuffInY]);                               // 왼 소매 안쪽
    if (sleeve !== 'none') pts.push([cx - bodyHalf * .99, armpitY]); // 왼 겨드랑이
    pts.push([cx - waistHalf, H * .432]);
    pts.push([cx - hemHalf, hemY]);
    pts.push([cx - hemHalf * .55, hemY + H * .012]);
    pts.push([cx + hemHalf * .55, hemY + H * .012]);
    pts.push([cx + hemHalf, hemY]);
    pts.push([cx + waistHalf, H * .432]);
    if (sleeve !== 'none') pts.push([cx + bodyHalf * .99, armpitY]);
    pts.push([cx + cuffIn, cuffInY]);
    pts.push([cx + cuffOut, cuffY]);
    pts.push([cx + shHalf, shY]);
    pts.push([cx + shHalf * .70, shY + H * .006]);
    pts.push([cx + neckHalf, neckY]);
    pts.push([cx + neckHalf * .55, neckY + H * (g.neck === 'v' || g.neck === 'deepv' ? .045 : .014)]);
    pts.push([cx, neckY + H * (g.neck === 'v' ? .052 : g.neck === 'deepv' ? .075 : .016)]);
    pts.push([cx - neckHalf * .55, neckY + H * (g.neck === 'v' || g.neck === 'deepv' ? .045 : .014)]);

    var built = topAnchorsOf({
      cx: cx, neckHalf: neckHalf, neckY: neckY, shY: shY, shHalf: shHalf,
      armpitY: armpitY, bodyHalf: bodyHalf, chestY: H * .330,
      waistHalf: waistHalf, waistY: H * .432, hemHalf: hemHalf, hemY: hemY,
      sleeve: sleeve, cuffY: cuffY, cuffOut: cuffOut, cuffIn: cuffIn, cuffInY: cuffInY,
      neck: g.neck
    });
    return { pts: pts, anchors: built.anchors, geom: built.geom };
  }

  /* =======================================================================
   * 3-b. 대응점 생성기 — **옷본과 반입 사진이 같은 식을 쓴다**
   *
   * 절차적 옷본은 이 숫자들을 설계로 정하고, 사진에서 반입한 옷은 실루엣에서
   * 재서 넣는다. 그 뒤는 완전히 같다.
   *
   * 이렇게 갈라놓기 전에는 반입 쪽이 대응점을 다섯 쌍(목·어깨·소매끝·허리·
   * 밑단)만 만들었다. 그래서 bodyAnchors 가 겨드랑이(pitL)를 읽는 순간
   * 그대로 터졌고, 소매 조각도 만들어지지 않았다. 반입한 옷은 **입어볼 수
   * 없는 상태**였다는 뜻이다.
   * ===================================================================== */
  function topAnchorsOf(P) {
    var cx = P.cx;
    var hasSleeve = P.sleeve !== 'none' && P.cuffY > P.armpitY * 1.05;
    var midSleeveY = P.armpitY + (P.cuffY - P.armpitY) * 0.5;
    return {
      // 대응점이 성길수록 그 사이의 천이 제멋대로 늘어난다. 겨드랑이와 가슴을
      // 넣어 몸통을 네 단으로 묶으면 어깨-허리 사이가 접히지 않는다.
      anchors: {
        neckL:  [cx - P.neckHalf, P.neckY],
        neckR:  [cx + P.neckHalf, P.neckY],
        shL:    [cx - P.shHalf, P.shY],
        shR:    [cx + P.shHalf, P.shY],
        pitL:   [cx - P.bodyHalf * .99, P.armpitY],
        pitR:   [cx + P.bodyHalf * .99, P.armpitY],
        chestL: [cx - P.bodyHalf, P.chestY],
        chestR: [cx + P.bodyHalf, P.chestY],
        // 소매는 몸통과 따로 변형되므로(tryon.js buildParts) 안쪽 가장자리까지
        // 필요하다. 어깨끝과 소매끝만 묶으면 그 사이가 몸통 쪽으로 빨려 들어가
        // 팔에 구멍이 뚫린다.
        // 중간 지지점은 **소매 구간 안**(겨드랑이~소맷부리)에 놓아야 한다.
        // 어깨~소맷부리의 중점으로 잡으면 반팔에서는 그 점이 겨드랑이보다
        // 위, 즉 소매가 아닌 요크 영역에 떨어져 소매 변형이 뒤틀린다.
        elbowOutL: hasSleeve ? [cx - (P.shHalf + (P.cuffOut - P.shHalf) * .5) * 1.02, midSleeveY] : null,
        elbowOutR: hasSleeve ? [cx + (P.shHalf + (P.cuffOut - P.shHalf) * .5) * 1.02, midSleeveY] : null,
        elbowInL:  hasSleeve ? [cx - (P.bodyHalf * .99 + (P.cuffIn - P.bodyHalf * .99) * .5) * .99, midSleeveY] : null,
        elbowInR:  hasSleeve ? [cx + (P.bodyHalf * .99 + (P.cuffIn - P.bodyHalf * .99) * .5) * .99, midSleeveY] : null,
        armL:   [cx - P.cuffOut, P.cuffY],
        armR:   [cx + P.cuffOut, P.cuffY],
        cuffInL: hasSleeve ? [cx - P.cuffIn, P.cuffInY] : null,
        cuffInR: hasSleeve ? [cx + P.cuffIn, P.cuffInY] : null,
        waistL: [cx - P.waistHalf, P.waistY],
        waistR: [cx + P.waistHalf, P.waistY],
        hemL:   [cx - P.hemHalf, P.hemY],
        hemR:   [cx + P.hemHalf, P.hemY]
      },
      geom: { cx: cx, shY: P.shY, neckY: P.neckY, armpitY: P.armpitY, hemY: P.hemY,
              shHalf: P.shHalf, bodyHalf: P.bodyHalf, waistHalf: P.waistHalf,
              hemHalf: P.hemHalf, cuffY: P.cuffY, cuffOut: P.cuffOut,
              sleeve: P.sleeve, neck: P.neck }
    };
  }

  /** 하의 — 허리에서 시작해 밑단까지 */
  function bottomOutline(g) {
    var cx = W / 2, fit = g.fit == null ? 1 : g.fit;
    var waistY = H * .045;
    var waistHalf = (g.waistHalf || .215) * W;
    var hipHalf = (g.hipHalf || .255) * W * fit;
    var hipY = H * .232;                                   // 허리~발목 사다리
    var hemY = H * (HEM_Y_B[g.hem] || HEM_Y_B.ankle);
    var crotchY = H * .318;
    var isSkirt = g.shape === 'skirt';
    var legHalf = (g.legHalf || .118) * W * fit;
    var pts = [];

    if (isSkirt) {
      var flare = g.flare == null ? 1.25 : g.flare;
      pts = [
        [cx - waistHalf, waistY], [cx - hipHalf, hipY],
        [cx - hipHalf * flare, hemY], [cx, hemY + H * .018],
        [cx + hipHalf * flare, hemY], [cx + hipHalf, hipY],
        [cx + waistHalf, waistY], [cx, waistY - H * .012]
      ];
    } else {
      /* 밑단은 **수평선**이다.
       * 예전에는 바깥 밑단과 안쪽 밑단의 높이를 다르게 두었는데, 곡선
       * 보간(Catmull-Rom)이 그 사이를 둥글게 이어 바짓단이 양말 코처럼
       * 말렸다. 그 둥근 끝 바깥에 원래 바지가 남아 발목에 검은 자국이
       * 생겼다. 세 점을 같은 높이에 두어 접선을 수평으로 만든다. */
      var legOut = legHalf * (g.taper == null ? 1.0 : g.taper) + legHalf * .25;
      var legIn = legHalf * .35;
      var legLift = H * .014;   // 밑단 모서리를 각지게 만드는 보조점
      pts = [
        [cx - waistHalf, waistY], [cx - hipHalf, hipY],
        [cx - legOut, hemY - legLift],
        [cx - legOut, hemY],
        [cx - legIn,  hemY],
        [cx - legIn,  hemY - legLift],
        [cx - legHalf * .08, crotchY + H * .04],
        [cx, crotchY],
        [cx + legHalf * .08, crotchY + H * .04],
        [cx + legIn,  hemY - legLift],
        [cx + legIn,  hemY],
        [cx + legOut, hemY],
        [cx + legOut, hemY - legLift],
        [cx + hipHalf, hipY], [cx + waistHalf, waistY], [cx, waistY - H * .012]
      ];
    }
    var builtB = bottomAnchorsOf({
      cx: cx, waistY: waistY, waistHalf: waistHalf, hipY: hipY, hipHalf: hipHalf,
      crotchY: crotchY, hemY: hemY, legHalf: legHalf,
      taper: g.taper == null ? 1 : g.taper, isSkirt: isSkirt,
      flare: g.flare == null ? 1.25 : g.flare, crotchDrop: H * .04
    });
    return { pts: pts, anchors: builtB.anchors, geom: builtB.geom };
  }

  /** 하의 대응점 생성기 — 상의와 같은 이유로 옷본·반입 사진이 공유한다 */
  function bottomAnchorsOf(P) {
    var cx = P.cx;
    // 바지는 다리가 둘이다. 바깥 윤곽만 대응시키면 가랑이 노치가 몸의
    // 엉뚱한 높이에 놓여 다리가 토막나 보인다 — 실제로 그렇게 나왔다.
    // 가랑이와 안쪽 밑단을 함께 묶어야 두 다리가 제자리를 찾는다.
    var a = {
      waistL: [cx - P.waistHalf, P.waistY], waistR: [cx + P.waistHalf, P.waistY],
      hipL:   [cx - P.hipHalf, P.hipY],     hipR:   [cx + P.hipHalf, P.hipY],
      hemL:   [cx - (P.isSkirt ? P.hipHalf * P.flare : P.legHalf * 1.25), P.hemY],
      hemR:   [cx + (P.isSkirt ? P.hipHalf * P.flare : P.legHalf * 1.25), P.hemY]
    };
    if (!P.isSkirt) {
      a.crotchC = [cx, P.crotchY];
      a.hemLin  = [cx - P.legHalf * .35, P.hemY];
      a.hemRin  = [cx + P.legHalf * .35, P.hemY];
      /* 다리 하나를 통째로 묶는 대응점 6개.
       * 가랑이와 밑단만 잡아두면 그 사이의 안쪽 솔기가 자유롭게 벌어져
       * 두 다리가 한 덩어리로 붙어 버린다(치마처럼 보인다). 소매를 따로
       * 변형하는 것과 같은 이유로, 다리도 각각 변형한다. */
      var outAtHem = P.legHalf * P.taper + P.legHalf * .25;
      var topOut = P.hipHalf * .92, topIn = P.legHalf * .08;
      var leg = function (sign) {
        var pts = [];
        [0, .5, 1].forEach(function (t) {
          var y = P.crotchY + t * (P.hemY - P.crotchY);
          var o = topOut + (outAtHem - topOut) * t;
          var iN = topIn + (P.legHalf * .35 - topIn) * t;
          pts.push([cx + sign * o, y], [cx + sign * iN, y + (t === 0 ? P.crotchDrop : 0)]);
        });
        return pts;
      };
      a.legL = leg(-1);
      a.legR = leg(1);
    }
    return {
      anchors: a,
      geom: { cx: cx, waistY: P.waistY, hipY: P.hipY, hemY: P.hemY,
              waistHalf: P.waistHalf, hipHalf: P.hipHalf,
              isSkirt: P.isSkirt, crotchY: P.crotchY }
    };
  }

  /* =======================================================================
   * 4. 거리 변환 — 가장자리 앰비언트 오클루전(AO)에 쓴다
   *    실루엣 경계로 갈수록 어두워야 옷이 "떠 있지" 않는다.
   * ===================================================================== */
  function distanceInside(alpha, w, h) {
    var INF = 1e7, d = new Float32Array(w * h);
    for (var i = 0; i < d.length; i++) d[i] = alpha[i] ? INF : 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = y * w + x; if (!d[p]) continue;
        var m = d[p];
        if (x > 0) m = Math.min(m, d[p - 1] + 1);
        if (y > 0) m = Math.min(m, d[p - w] + 1);
        if (x > 0 && y > 0) m = Math.min(m, d[p - w - 1] + 1.414);
        if (x < w - 1 && y > 0) m = Math.min(m, d[p - w + 1] + 1.414);
        d[p] = m;
      }
    }
    for (var y2 = h - 1; y2 >= 0; y2--) {
      for (var x2 = w - 1; x2 >= 0; x2--) {
        var q = y2 * w + x2; if (!d[q]) continue;
        var n = d[q];
        if (x2 < w - 1) n = Math.min(n, d[q + 1] + 1);
        if (y2 < h - 1) n = Math.min(n, d[q + w] + 1);
        if (x2 < w - 1 && y2 < h - 1) n = Math.min(n, d[q + w + 1] + 1.414);
        if (x2 > 0 && y2 < h - 1) n = Math.min(n, d[q + w - 1] + 1.414);
        d[q] = n;
      }
    }
    return d;
  }

  /* =======================================================================
   * 5. 직조 텍스처 — 소재를 구분 짓는 것은 색이 아니라 결이다
   * ===================================================================== */
  function weaveAt(kind, x, y, n1, n2) {
    switch (kind) {
      case 'denim':
        // 능직(twill) 대각선 + 씨실 슬럽. 데님이 데님으로 보이는 근거.
        return Math.sin((x * 0.62 + y * 0.62)) * 0.42 +
               Math.sin(y * 1.9) * 0.16 + (n2 - .5) * 0.9;
      case 'twill':
        return Math.sin((x * 0.5 - y * 0.5)) * 0.30 + (n2 - .5) * 0.7;
      case 'rib':
        // 니트 골 — 세로 리브가 굵고 가로 코가 얕게 얹힌다
        return Math.sin(x * 0.42) * 0.55 + Math.sin(y * 1.35) * 0.14 + (n2 - .5) * 0.5;
      case 'wale':
        return Math.sin(x * 0.30) * 0.72 + (n2 - .5) * 0.35;
      case 'linen':
        return (Math.sin(x * 1.15) + Math.sin(y * 1.05)) * 0.24 + (n2 - .5) * 1.1;
      case 'tweed':
        return (n1 - .5) * 1.5 + Math.sin(x * .8 + n2 * 6) * .28;
      case 'satin':
        return (n1 - .5) * 0.34;
      case 'grainy':
        return (n1 - .5) * 0.75 + (n2 - .5) * 0.55;
      default: // plain
        return Math.sin(x * 1.6) * 0.10 + Math.sin(y * 1.6) * 0.10 + (n2 - .5) * 0.75;
    }
  }

  /* =======================================================================
   * 6. 렌더 — 패턴 + 소재 + 주름 + AO → 사진 같은 래스터
   * ===================================================================== */
  function renderGarment(g, scale) {
    scale = scale || 1;
    W = Math.max(64, Math.round(BASE_W * scale));
    H = Math.max(80, Math.round(BASE_H * scale));
    try { return renderAt(g); } finally { W = BASE_W; H = BASE_H; }
  }

  function renderAt(g) {
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var out = (g.cat === 'bottom') ? bottomOutline(g) : topOutline(g);
    var M = MATERIALS[g.material] || MATERIALS.cotton;
    var rand = rngFrom(hashStr(g.id));

    /* 실루엣 채우기 */
    ctx.beginPath(); smoothPath(ctx, out.pts, g.cat === 'bottom' ? .45 : .55);
    ctx.fillStyle = g.baseHex; ctx.fill();

    var img = ctx.getImageData(0, 0, W, H), d = img.data;
    var alpha = new Uint8Array(W * H);
    for (var i = 0, p = 0; i < d.length; i += 4, p++) alpha[p] = d[i + 3] > 128 ? 1 : 0;
    var dist = distanceInside(alpha, W, H);

    var nA = fbm(W, H, 26, 2, rand);      // 큰 얼룩(염색 불균일)
    var nB = fbm(W, H, 5, 2, rand);       // 실 단위 거칠기
    var nF = valueNoise(W, H, 46, rand);  // 주름 위상 흔들기

    var G = out.geom;
    var cx = G.cx;
    var foldPhase = rand() * 6.28;

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var q = y * W + x; if (!alpha[q]) continue;
        var idx = q * 4;

        var na = nA(x, y), nb = nB(x, y);

        /* --- 직조 --- */
        var weave = weaveAt(M.weave, x, y, na, nb) * M.grain;

        /* --- 드레이프 주름 ---
         * 옷은 어깨(또는 허리)에 걸려 아래로 늘어진다. 주름은 그 지지점에서
         * 방사되며, 아래로 갈수록 간격이 벌어지고 깊어진다. 위상에 노이즈를
         * 섞지 않으면 커튼처럼 규칙적으로 보인다. */
        var rel = clamp(y / H, 0, 1);
        var spread = 0.45 + rel * 0.85;
        var u = (x - cx) / (W * 0.5) / spread;
        var fold = Math.sin(u * 9.0 * M.foldFreq + foldPhase + nF(x, y) * 3.4) *
                   M.fold * (0.35 + rel * 0.95);
        // 몸통 중앙은 몸에 눌려 주름이 얕다
        fold *= 0.55 + 0.45 * Math.min(1, Math.abs(u) * 1.7);

        /* --- 구조적 그늘 --- */
        var shade = 0;
        if (g.cat !== 'bottom') {
          // 겨드랑이 아래 · 가슴 밑 · 허리 접힘
          var dArm = Math.abs(y - G.armpitY) / (H * .10);
          var edgeX = Math.abs(Math.abs(x - cx) - G.bodyHalf) / (W * .09);
          if (dArm < 1 && edgeX < 1) shade -= (1 - dArm) * (1 - edgeX) * 0.16;
          var dW = Math.abs(y - H * .46) / (H * .085);
          if (dW < 1) shade -= (1 - dW) * 0.055;
          // 소매가 몸통에 겹치는 진동선
          if (G.sleeve !== 'none') {
            var dSeam = Math.abs(Math.abs(x - cx) - G.bodyHalf * .99) / (W * .012);
            if (dSeam < 1 && y > G.shY && y < G.armpitY + H * .02) shade -= (1 - dSeam) * 0.10;
          }
        } else {
          var dCr = Math.abs(y - G.crotchY) / (H * .06);
          if (dCr < 1 && Math.abs(x - cx) < W * .10) shade -= (1 - dCr) * 0.09;
        }

        /* --- 가장자리 AO --- */
        var ao = 1 - clamp(dist[q] / (W * .050), 0, 1);
        shade -= ao * ao * M.ao * 0.5;

        /* --- 전체 볼륨: 몸은 원통이다 --- */
        var cyl = Math.cos(clamp((x - cx) / (G.bodyHalf || G.hipHalf || W * .25), -1.4, 1.4) * 1.05);
        shade += (cyl - 0.72) * 0.20;

        /* --- 광택 --- */
        var spec = 0;
        if (M.spec > 0.02) {
          var sx = (x - (cx - W * 0.10)) / (W * M.specW);
          spec = Math.exp(-sx * sx * 2.2) * M.spec * clamp(cyl, 0, 1);
          spec *= 0.65 + 0.35 * (1 - Math.abs(fold) / Math.max(1e-4, M.fold));
        }

        var mul = 1 + weave + fold + shade + (na - .5) * M.sheen;
        mul = clamp(mul, 0.30, 1.55);
        var add = spec * 255;

        d[idx]     = clamp(d[idx]     * mul + add, 0, 255);
        d[idx + 1] = clamp(d[idx + 1] * mul + add, 0, 255);
        d[idx + 2] = clamp(d[idx + 2] * mul + add, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);

    /* --- 디테일: 봉제선 · 단추 · 리브 · 칼라 --- */
    drawDetails(ctx, g, out);

    return { canvas: cv, anchors: out.anchors, geom: out.geom, material: M };
  }

  function drawDetails(ctx, g, out) {
    var G = out.geom, det = g.details || [];
    ctx.save();
    ctx.beginPath(); smoothPath(ctx, out.pts, g.cat === 'bottom' ? .45 : .55);
    ctx.clip();                                    // 디테일이 옷 밖으로 나가지 않게

    var dark = 'rgba(0,0,0,.28)', light = 'rgba(255,255,255,.20)';

    function stitch(x1, y1, x2, y2, col) {
      ctx.save();
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1.6;
      ctx.strokeStyle = col || dark;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    }

    if (g.cat !== 'bottom') {
      /* 칼라 */
      if (G.neck === 'shirt') {
        ctx.fillStyle = 'rgba(0,0,0,.10)';
        ctx.beginPath();
        ctx.moveTo(G.cx - W * .12, G.neckY - H * .004);
        ctx.lineTo(G.cx - W * .035, G.neckY + H * .075);
        ctx.lineTo(G.cx, G.neckY + H * .022);
        ctx.lineTo(G.cx + W * .035, G.neckY + H * .075);
        ctx.lineTo(G.cx + W * .12, G.neckY - H * .004);
        ctx.lineTo(G.cx + W * .10, G.neckY - H * .022);
        ctx.lineTo(G.cx - W * .10, G.neckY - H * .022);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = dark; ctx.lineWidth = 1.4; ctx.stroke();
      } else if (G.neck === 'turtle') {
        ctx.fillStyle = 'rgba(0,0,0,.13)';
        ctx.fillRect(G.cx - W * .105, G.neckY - H * .055, W * .21, H * .062);
        for (var t = 0; t < 9; t++) {
          stitch(G.cx - W * .105 + t * W * .023, G.neckY - H * .055,
                 G.cx - W * .105 + t * W * .023, G.neckY + H * .007, 'rgba(0,0,0,.16)');
        }
      } else {
        // 넥 리브(골무늬) — 라운드/브이 공통
        ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 5;
        ctx.beginPath();
        if (G.neck === 'v' || G.neck === 'deepv') {
          ctx.moveTo(G.cx - W * (NECK[G.neck].half), G.neckY);
          ctx.lineTo(G.cx, G.neckY + H * (G.neck === 'v' ? .052 : .075));
          ctx.lineTo(G.cx + W * (NECK[G.neck].half), G.neckY);
        } else {
          ctx.ellipse(G.cx, G.neckY + H * .002, W * (NECK[G.neck] || NECK.crew).half,
                      H * .020, 0, 0, Math.PI);
        }
        ctx.stroke();
      }

      /* 앞여밈 + 단추 */
      if (det.indexOf('button') >= 0) {
        stitch(G.cx - W * .022, G.neckY + H * .02, G.cx - W * .022, G.hemY - H * .01);
        stitch(G.cx + W * .022, G.neckY + H * .02, G.cx + W * .022, G.hemY - H * .01, light);
        var n = 5;
        for (var b = 0; b < n; b++) {
          var by = G.neckY + H * .075 + b * (G.hemY - G.neckY - H * .10) / n;
          ctx.beginPath(); ctx.arc(G.cx, by, 5.0, 0, 6.284);
          ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.fill();
          ctx.beginPath(); ctx.arc(G.cx - 1, by - 1, 4.2, 0, 6.284);
          ctx.fillStyle = 'rgba(255,255,255,.30)'; ctx.fill();
        }
      }
      if (det.indexOf('zip') >= 0) {
        ctx.strokeStyle = 'rgba(0,0,0,.32)'; ctx.lineWidth = 3.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(G.cx, G.neckY); ctx.lineTo(G.cx, G.hemY - H * .005); ctx.stroke();
        ctx.setLineDash([]);
      }
      /* 소매 커프스 */
      if (det.indexOf('cuff') >= 0 && G.sleeve === 'long') {
        ctx.fillStyle = 'rgba(0,0,0,.11)';
        ctx.fillRect(G.cx - G.cuffOut - 6, G.cuffY - H * .045, G.cuffOut - G.shHalf * .55, H * .048);
        ctx.fillRect(G.cx + G.shHalf * .55, G.cuffY - H * .045, G.cuffOut - G.shHalf * .55, H * .048);
      }
      /* 밑단 리브 */
      if (det.indexOf('rib') >= 0) {
        ctx.fillStyle = 'rgba(0,0,0,.10)';
        ctx.fillRect(0, G.hemY - H * .038, W, H * .050);
        for (var r = 0; r < 40; r++) stitch(r * W / 40, G.hemY - H * .038, r * W / 40, G.hemY + H * .012, 'rgba(0,0,0,.13)');
      }
      /* 가슴 포켓 */
      if (det.indexOf('pocket') >= 0) {
        ctx.strokeStyle = dark; ctx.lineWidth = 1.5;
        ctx.strokeRect(G.cx + W * .075, G.neckY + H * .105, W * .085, H * .062);
      }
      /* 어깨 절개선 */
      stitch(G.cx - G.shHalf * .96, G.shY + 3, G.cx - G.bodyHalf * .99, G.armpitY, 'rgba(0,0,0,.14)');
      stitch(G.cx + G.shHalf * .96, G.shY + 3, G.cx + G.bodyHalf * .99, G.armpitY, 'rgba(0,0,0,.14)');
    } else {
      /* 하의: 허리밴드 · 인심 · 주머니 */
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.fillRect(0, G.waistY - H * .012, W, H * .052);
      stitch(0, G.waistY + H * .040, W, G.waistY + H * .040, 'rgba(255,255,255,.22)');
      if (!G.isSkirt) {
        stitch(G.cx, G.crotchY, G.cx, G.hemY, 'rgba(0,0,0,.16)');
        stitch(G.cx - W * .06, G.waistY + H * .05, G.cx - W * .02, H * .20, 'rgba(0,0,0,.14)');
      }
      if (det.indexOf('pocket') >= 0) {
        ctx.strokeStyle = dark; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(G.cx - G.hipHalf * .92, G.waistY + H * .048);
        ctx.quadraticCurveTo(G.cx - G.hipHalf * .55, H * .12, G.cx - G.hipHalf * .42, H * .055);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(G.cx + G.hipHalf * .92, G.waistY + H * .048);
        ctx.quadraticCurveTo(G.cx + G.hipHalf * .55, H * .12, G.cx + G.hipHalf * .42, H * .055);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h;
  }

  /* =======================================================================
   * 7. 카탈로그 — 스타일 8계열 × 카테고리
   * ===================================================================== */
  var STYLES = {
    minimal:  { ko: '미니멀',   desc: '장식을 걷어낸 기본형. 색과 실루엣만 남긴다' },
    casual:   { ko: '캐주얼',   desc: '일상복. 편안한 여유분과 면 소재' },
    office:   { ko: '오피스',   desc: '격식과 구조. 어깨선이 서고 라인이 정돈된다' },
    street:   { ko: '스트릿',   desc: '큰 여유분, 낮은 어깨, 긴 기장' },
    romantic: { ko: '로맨틱',   desc: '부드러운 드레이프와 곡선' },
    sporty:   { ko: '스포티',   desc: '기능성 소재, 리브, 지퍼' },
    classic:  { ko: '클래식',   desc: '오래 가는 정통 아이템' },
    chic:     { ko: '시크',     desc: '광택과 대비. 도시적인 마감' }
  };

  var CATS = {
    top:    { ko: '상의',   slot: 'top' },
    outer:  { ko: '아우터', slot: 'outer' },
    bottom: { ko: '하의',   slot: 'bottom' },
    dress:  { ko: '원피스', slot: 'dress' }
  };

  function G(o) { return o; }

  var CATALOG = [
    /* ---------- 상의 ---------- */
    G({ id: 't-crew-cotton', ko: '베이직 라운드 티셔츠', cat: 'top', style: 'minimal', material: 'jersey', baseHex: '#E8E6E1', neck: 'crew', sleeve: 'short', hem: 'hip', fit: 1.00, details: [] }),
    G({ id: 't-crew-long', ko: '롱슬리브 티셔츠', cat: 'top', style: 'casual', material: 'jersey', baseHex: '#5C6B7A', neck: 'crew', sleeve: 'long', hem: 'hip', fit: 1.02, details: ['cuff'] }),
    G({ id: 't-v-knit', ko: '브이넥 니트', cat: 'top', style: 'minimal', material: 'knit', baseHex: '#C8B49A', neck: 'v', sleeve: 'long', hem: 'hip', fit: 1.00, details: ['rib', 'cuff'] }),
    G({ id: 't-turtle', ko: '터틀넥 니트', cat: 'top', style: 'classic', material: 'knit', baseHex: '#2F3440', neck: 'turtle', sleeve: 'long', hem: 'hip', fit: .94, details: ['rib', 'cuff'] }),
    G({ id: 't-shirt-oxford', ko: '옥스퍼드 셔츠', cat: 'top', style: 'classic', material: 'cotton', baseHex: '#DCE4EC', neck: 'shirt', sleeve: 'long', hem: 'hip', fit: 1.06, details: ['button', 'cuff', 'pocket'] }),
    G({ id: 't-shirt-linen', ko: '린넨 셔츠', cat: 'top', style: 'casual', material: 'linen', baseHex: '#EFE7D6', neck: 'shirt', sleeve: 'threeq', hem: 'hip', fit: 1.10, details: ['button'] }),
    G({ id: 't-blouse-silk', g: 'f', ko: '실크 블라우스', cat: 'top', style: 'romantic', material: 'silk', baseHex: '#F2D9DC', neck: 'v', sleeve: 'long', hem: 'hip', fit: 1.08, details: ['button'] }),
    G({ id: 't-boat-fine', g: 'f', ko: '보트넥 얇은 니트', cat: 'top', style: 'chic', material: 'knit', baseHex: '#8E92A8', neck: 'boat', sleeve: 'threeq', hem: 'waist', fit: .96, details: ['rib'] }),
    G({ id: 't-square-crop', g: 'f', ko: '스퀘어넥 크롭탑', cat: 'top', style: 'romantic', material: 'jersey', baseHex: '#E9C7B4', neck: 'square', sleeve: 'cap', hem: 'crop', fit: .92, details: [] }),
    G({ id: 't-sweat', ko: '스웨트셔츠', cat: 'top', style: 'casual', material: 'cotton', baseHex: '#A9AFA4', neck: 'crew', sleeve: 'long', hem: 'hip', fit: 1.16, details: ['rib', 'cuff'] }),
    G({ id: 't-hoodie-big', ko: '오버핏 후디', cat: 'top', style: 'street', material: 'cotton', baseHex: '#4A4A50', neck: 'crew', sleeve: 'long', hem: 'thigh', fit: 1.30, shoulderHalf: .335, details: ['rib', 'cuff', 'pocket'] }),
    G({ id: 't-tank-rib', g: 'f', ko: '리브 슬리브리스', cat: 'top', style: 'minimal', material: 'knit', baseHex: '#D8D3CC', neck: 'square', sleeve: 'none', hem: 'hip', fit: .90, details: ['rib'] }),
    G({ id: 't-polo', ko: '피케 폴로', cat: 'top', style: 'classic', material: 'cotton', baseHex: '#2C4A5E', neck: 'shirt', sleeve: 'short', hem: 'hip', fit: 1.02, details: ['button'] }),
    G({ id: 't-tech-zip', ko: '집업 트레이닝 탑', cat: 'top', style: 'sporty', material: 'tech', baseHex: '#20304A', neck: 'turtle', sleeve: 'long', hem: 'hip', fit: 1.06, details: ['zip', 'rib', 'cuff'] }),
    G({ id: 't-deepv-drape', g: 'f', ko: '드레이프 브이넥', cat: 'top', style: 'chic', material: 'silk', baseHex: '#3A3540', neck: 'deepv', sleeve: 'long', hem: 'hip', fit: 1.10, details: [] }),
    G({ id: 't-cable', ko: '케이블 니트', cat: 'top', style: 'classic', material: 'knit', baseHex: '#E4DCC8', neck: 'crew', sleeve: 'long', hem: 'hip', fit: 1.14, details: ['rib', 'cuff'] }),

    /* ---------- 아우터 ---------- */
    G({ id: 'o-blazer', ko: '테일러드 블레이저', cat: 'outer', style: 'office', material: 'wool', baseHex: '#3B4250', neck: 'deepv', sleeve: 'long', hem: 'thigh', fit: 1.12, shoulderHalf: .310, details: ['button', 'pocket', 'cuff'] }),
    G({ id: 'o-blazer-oversize', ko: '오버사이즈 블레이저', cat: 'outer', style: 'street', material: 'wool', baseHex: '#6B6257', neck: 'deepv', sleeve: 'long', hem: 'thigh', fit: 1.32, shoulderHalf: .345, details: ['button', 'pocket'] }),
    G({ id: 'o-trench', ko: '트렌치코트', cat: 'outer', style: 'classic', material: 'cotton', baseHex: '#C4AC86', neck: 'shirt', sleeve: 'long', hem: 'knee', fit: 1.22, details: ['button', 'pocket', 'cuff'] }),
    G({ id: 'o-cardigan', ko: '루즈 가디건', cat: 'outer', style: 'casual', material: 'knit', baseHex: '#B9AFA0', neck: 'deepv', sleeve: 'long', hem: 'thigh', fit: 1.20, details: ['button', 'rib'] }),
    G({ id: 'o-denim-jk', ko: '데님 재킷', cat: 'outer', style: 'casual', material: 'denim', baseHex: '#4E6E96', neck: 'shirt', sleeve: 'long', hem: 'waist', fit: 1.12, details: ['button', 'pocket', 'cuff'] }),
    G({ id: 'o-leather-rider', ko: '레더 라이더 재킷', cat: 'outer', style: 'chic', material: 'leather', baseHex: '#26262A', neck: 'deepv', sleeve: 'long', hem: 'waist', fit: 1.06, details: ['zip', 'pocket'] }),
    G({ id: 'o-coat-wool', ko: '싱글 울코트', cat: 'outer', style: 'classic', material: 'wool', baseHex: '#43403C', neck: 'deepv', sleeve: 'long', hem: 'knee', fit: 1.24, details: ['button', 'pocket'] }),
    G({ id: 'o-tweed-jk', g: 'f', ko: '트위드 재킷', cat: 'outer', style: 'office', material: 'tweed', baseHex: '#C9BCB2', neck: 'crew', sleeve: 'long', hem: 'hip', fit: 1.08, details: ['button', 'pocket'] }),
    G({ id: 'o-windbreak', ko: '윈드브레이커', cat: 'outer', style: 'sporty', material: 'tech', baseHex: '#1F5F52', neck: 'turtle', sleeve: 'long', hem: 'hip', fit: 1.26, details: ['zip', 'pocket', 'rib'] }),
    G({ id: 'o-shirt-jk', ko: '셔츠 재킷', cat: 'outer', style: 'street', material: 'wool', baseHex: '#6E7B6A', neck: 'shirt', sleeve: 'long', hem: 'thigh', fit: 1.24, details: ['button', 'pocket'] }),

    /* ---------- 하의 ---------- */
    G({ id: 'b-slim-denim', ko: '슬림 데님', cat: 'bottom', shape: 'pants', style: 'casual', material: 'denim', baseHex: '#3E5A7E', hem: 'ankle', fit: .94, legHalf: .098, taper: .80, details: ['pocket'] }),
    G({ id: 'b-straight-denim', ko: '스트레이트 데님', cat: 'bottom', shape: 'pants', style: 'casual', material: 'denim', baseHex: '#6D8DB4', hem: 'ankle', fit: 1.02, legHalf: .120, taper: 1.0, details: ['pocket'] }),
    G({ id: 'b-wide-denim', ko: '와이드 데님', cat: 'bottom', shape: 'pants', style: 'street', material: 'denim', baseHex: '#2F4460', hem: 'ankle', fit: 1.14, legHalf: .155, taper: 1.15, details: ['pocket'] }),
    G({ id: 'b-slacks', ko: '테일러드 슬랙스', cat: 'bottom', shape: 'pants', style: 'office', material: 'wool', baseHex: '#33373F', hem: 'ankle', fit: 1.02, legHalf: .122, taper: .92, details: ['pocket'] }),
    G({ id: 'b-wide-slacks', ko: '와이드 슬랙스', cat: 'bottom', shape: 'pants', style: 'chic', material: 'wool', baseHex: '#8A8175', hem: 'ankle', fit: 1.10, legHalf: .158, taper: 1.10, details: ['pocket'] }),
    G({ id: 'b-chino', ko: '치노 팬츠', cat: 'bottom', shape: 'pants', style: 'classic', material: 'cotton', baseHex: '#B8A588', hem: 'ankle', fit: 1.00, legHalf: .118, taper: .90, details: ['pocket'] }),
    G({ id: 'b-cord', ko: '코듀로이 팬츠', cat: 'bottom', shape: 'pants', style: 'classic', material: 'corduroy', baseHex: '#7A5C42', hem: 'ankle', fit: 1.04, legHalf: .128, taper: .95, details: ['pocket'] }),
    G({ id: 'b-jogger', ko: '조거 팬츠', cat: 'bottom', shape: 'pants', style: 'sporty', material: 'tech', baseHex: '#33383D', hem: 'ankle', fit: 1.06, legHalf: .118, taper: .72, details: ['pocket'] }),
    G({ id: 'b-aline-skirt', g: 'f', ko: 'A라인 스커트', cat: 'bottom', shape: 'skirt', style: 'romantic', material: 'cotton', baseHex: '#C2A9B8', hem: 'knee', fit: 1.00, flare: 1.35, details: [] }),
    G({ id: 'b-pencil-skirt', g: 'f', ko: '펜슬 스커트', cat: 'bottom', shape: 'skirt', style: 'office', material: 'wool', baseHex: '#3A3B42', hem: 'knee', fit: .96, flare: 1.02, details: [] }),
    G({ id: 'b-pleats-skirt', g: 'f', ko: '플리츠 스커트', cat: 'bottom', shape: 'skirt', style: 'chic', material: 'silk', baseHex: '#7A8B7E', hem: 'knee', fit: 1.02, flare: 1.42, details: [] }),
    G({ id: 'b-denim-skirt', g: 'f', ko: '데님 스커트', cat: 'bottom', shape: 'skirt', style: 'casual', material: 'denim', baseHex: '#5B7CA6', hem: 'thigh', fit: 1.00, flare: 1.12, details: ['pocket'] }),

    /* ---------- 원피스 ---------- */
    G({ id: 'd-shirt-dress', g: 'f', ko: '셔츠 원피스', cat: 'dress', style: 'casual', material: 'cotton', baseHex: '#B7C4CC', neck: 'shirt', sleeve: 'long', hem: 'knee', fit: 1.10, hemOut: 1.28, details: ['button', 'pocket'] }),
    G({ id: 'd-slip', g: 'f', ko: '슬립 원피스', cat: 'dress', style: 'chic', material: 'silk', baseHex: '#4B4550', neck: 'square', sleeve: 'none', hem: 'knee', fit: .96, hemOut: 1.12, details: [] }),
    G({ id: 'd-knit-dress', g: 'f', ko: '니트 원피스', cat: 'dress', style: 'minimal', material: 'knit', baseHex: '#9C8F80', neck: 'turtle', sleeve: 'long', hem: 'knee', fit: 1.00, hemOut: 1.05, details: ['rib', 'cuff'] }),
    G({ id: 'd-flare', g: 'f', ko: '플레어 원피스', cat: 'dress', style: 'romantic', material: 'linen', baseHex: '#E6D2C0', neck: 'v', sleeve: 'short', hem: 'knee', fit: 1.02, waistIn: .82, hemOut: 1.55, details: [] }),
    G({ id: 'd-sheath', g: 'f', ko: '시스 원피스', cat: 'dress', style: 'office', material: 'wool', baseHex: '#33404C', neck: 'boat', sleeve: 'short', hem: 'knee', fit: .96, waistIn: .88, hemOut: 1.02, details: [] })
  ];

  var BY_ID = {};
  CATALOG.forEach(function (g) { BY_ID[g.id] = g; });

  /* 렌더 캐시 — 같은 옷을 반복해 그리지 않는다 */
  var _cache = {};
  function get(id) {
    if (_cache[id]) return _cache[id];
    var g = BY_ID[id] || _userById[id];
    if (!g) return null;
    var r = g.userPhoto ? loadUserRender(g) : renderGarment(g);
    r.spec = g;
    _cache[id] = r;
    return r;
  }
  function invalidate(id) {
    if (id) { delete _cache[id]; delete _thumbs[id]; }
    else { _cache = {}; _thumbs = {}; }
  }

  /** 썸네일 — 목록에 40벌을 띄우려면 원본 해상도로 그릴 수 없다 */
  var _thumbs = {};
  function thumb(id, px) {
    px = px || 132;
    var key = id + '@' + px;
    if (_thumbs[key]) return _thumbs[key];
    var g = BY_ID[id] || _userById[id];
    if (!g) return null;
    var cv;
    if (g.userPhoto) {
      var full = get(id);
      cv = document.createElement('canvas');
      var s = px / Math.max(full.canvas.width, full.canvas.height);
      cv.width = Math.round(full.canvas.width * s);
      cv.height = Math.round(full.canvas.height * s);
      cv.getContext('2d').drawImage(full.canvas, 0, 0, cv.width, cv.height);
    } else {
      cv = renderGarment(g, px / BASE_H).canvas;
    }
    _thumbs[key] = cv;
    return cv;
  }

  /* =======================================================================
   * 8. 사용자 반입 — 실제 상품 사진을 카탈로그에 넣는다
   *
   * 상품컷은 대부분 흰/회색 배경의 누끼컷이거나 고스트 마네킹컷이다.
   * 그 성질을 이용해 테두리에서 배경색을 학습하고 지운다. body.js의
   * personMask와 같은 발상이지만, 배경이 더 단순해 임계값을 낮게 잡을 수
   * 있고 대신 **구멍 메우기**가 필요하다(옷 안쪽의 밝은 부분이 배경으로
   * 오인되면 옷에 구멍이 뚫린다).
   * ===================================================================== */
  function cutout(source, maxSide) {
    var work = DETECT.toWorkCanvas(source, maxSide || 640);
    var w = work.w, h = work.h, ctx = work.ctx;
    var img = ctx.getImageData(0, 0, w, h), d = img.data;

    /* 테두리에서 배경색 학습 */
    var bg = [], band = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    for (var x = 0; x < w; x += 2) for (var by = 0; by < band; by++) {
      bg.push(labAt(d, (by * w + x) * 4));
      bg.push(labAt(d, ((h - 1 - by) * w + x) * 4));
    }
    for (var y = 0; y < h; y += 2) for (var bx = 0; bx < band; bx++) {
      bg.push(labAt(d, (y * w + bx) * 4));
      bg.push(labAt(d, (y * w + (w - 1 - bx)) * 4));
    }
    var centers = kmeansLab(bg, 2, 8);

    /* 배경과 가까운 픽셀을 후보로 두고, **테두리에서 연결된 것만** 지운다.
     * 연결성을 보지 않으면 흰 셔츠의 몸통이 통째로 날아간다. */
    var TH = 11;
    var cand = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < d.length; i += 4, p++) {
      var lab = labAt(d, i), best = 1e9;
      for (var c = 0; c < centers.length; c++) best = Math.min(best, CC.deltaE2000(lab, centers[c]));
      if (best < TH) cand[p] = 1;
    }
    var isBg = new Uint8Array(w * h), stack = [];
    for (var xx = 0; xx < w; xx++) { seed(xx, 0); seed(xx, h - 1); }
    for (var yy = 0; yy < h; yy++) { seed(0, yy); seed(w - 1, yy); }
    function seed(sx, sy) { var q = sy * w + sx; if (cand[q] && !isBg[q]) { isBg[q] = 1; stack.push(q); } }
    while (stack.length) {
      var q0 = stack.pop(), qx = q0 % w, qy = (q0 / w) | 0;
      if (qx > 0 && cand[q0 - 1] && !isBg[q0 - 1]) { isBg[q0 - 1] = 1; stack.push(q0 - 1); }
      if (qx < w - 1 && cand[q0 + 1] && !isBg[q0 + 1]) { isBg[q0 + 1] = 1; stack.push(q0 + 1); }
      if (qy > 0 && cand[q0 - w] && !isBg[q0 - w]) { isBg[q0 - w] = 1; stack.push(q0 - w); }
      if (qy < h - 1 && cand[q0 + w] && !isBg[q0 + w]) { isBg[q0 + w] = 1; stack.push(q0 + w); }
    }

    var fg = new Uint8Array(w * h), n = 0;
    for (var k = 0; k < fg.length; k++) { fg[k] = isBg[k] ? 0 : 1; if (fg[k]) n++; }
    fg = DETECT.morph(DETECT.morph(fg, w, h, 'erode', 1), w, h, 'dilate', 1);

    /* 알파 적용 + 경계 1px 페더 */
    for (var j = 0, p2 = 0; j < d.length; j += 4, p2++) {
      d[j + 3] = fg[p2] ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: work.canvas, ctx: ctx, w: w, h: h, mask: fg, ratio: n / (w * h) };
  }

  function labAt(d, i) { return CC.rgbToLab(d[i], d[i + 1], d[i + 2]); }

  function kmeansLab(pts, k, iters) {
    if (pts.length <= k) return pts.slice();
    var centers = [];
    for (var i = 0; i < k; i++) centers.push(pts[Math.floor(pts.length * (i + .5) / k)]);
    for (var it = 0; it < iters; it++) {
      var s = centers.map(function () { return { L: 0, a: 0, b: 0, n: 0 }; });
      for (var j = 0; j < pts.length; j++) {
        var bi = 0, bd = 1e9;
        for (var c = 0; c < centers.length; c++) {
          var dd = Math.pow(pts[j].L - centers[c].L, 2) + Math.pow(pts[j].a - centers[c].a, 2) + Math.pow(pts[j].b - centers[c].b, 2);
          if (dd < bd) { bd = dd; bi = c; }
        }
        s[bi].L += pts[j].L; s[bi].a += pts[j].a; s[bi].b += pts[j].b; s[bi].n++;
      }
      centers = s.map(function (v, idx) { return v.n ? { L: v.L / v.n, a: v.a / v.n, b: v.b / v.n } : centers[idx]; });
    }
    return centers;
  }

  /**
   * 누끼 이미지에서 앵커를 추정한다.
   * 상의: 가장 위 알파 행 = 어깨선, 그 아래 최대 폭 = 어깨끝,
   *       좌우 최외곽 = 소매끝, 마지막 행 = 밑단.
   * 자동값은 초안이며 사용자가 핸들로 고칠 수 있다 — 이 도구의 일관된 태도다.
   */
  /* =======================================================================
   * 사진에서 옷본의 숫자를 잰다
   *
   * 평면 상품컷(흰 배경에 펼쳐 놓은 옷)의 실루엣에는 필요한 것이 다 있다.
   * 잴 수 있는 것만 재고, 잴 수 없는 것(소맷부리 안쪽 모서리처럼 실루엣이
   * 거의 한 점으로 만나는 자리)은 같은 소매 종류의 옷본 비율을 쓴다.
   *
   * 핵심은 **겨드랑이**다. 소매가 몸통에서 갈라지는 지점 아래로는 소매와
   * 몸통 사이에 배경이 쐐기처럼 들어온다 — 한 행에 구간이 둘 이상 생긴다.
   * 그 쐐기의 꼭짓점이 곧 겨드랑이다. 추정할 필요가 없다.
   * ===================================================================== */
  function rowScan(mask, w, h) {
    var rows = [];
    for (var y = 0; y < h; y++) {
      var a = -1, b = -1, n = 0, runs = [], st = -1;
      for (var x = 0; x < w; x++) {
        if (mask[y * w + x]) {
          if (a < 0) a = x; b = x; n++;
          if (st < 0) st = x;
        } else if (st >= 0) {
          if (x - st > w * 0.012) runs.push([st, x - 1]);
          st = -1;
        }
      }
      if (st >= 0 && w - st > w * 0.012) runs.push([st, w - 1]);
      var big = 0;
      for (var i = 1; i < runs.length; i++) {
        if (runs[i][1] - runs[i][0] > runs[big][1] - runs[big][0]) big = i;
      }
      rows.push({
        y: y, x0: a, x1: b, w: a < 0 ? 0 : b - a + 1, n: n, runs: runs,
        core: runs.length ? runs[big][1] - runs[big][0] + 1 : 0,
        coreL: runs.length ? runs[big][0] : -1,
        coreR: runs.length ? runs[big][1] : -1
      });
    }
    return rows;
  }

  /* 소매 종류별 비율 — 실루엣이 알려주지 않는 두 값만 여기서 가져온다.
   *   K : 소맷부리 안쪽이 어깨~소매끝 사이 어디쯤인가
   *   R : 소맷부리 안쪽이 겨드랑이~소매끝 사이 어디쯤인가(위로)
   * (숫자는 절차적 옷본의 값에서 그대로 뽑았다) */
  /* 기장 판정 — 길이 ÷ 폭.
   * 사진에는 "이 옷이 몸의 어디까지 오는가"가 적혀 있지 않다. 대신 실제
   * 옷의 비율이 알려준다: 어깨 너비 대비 길이(상의), 골반 너비 대비
   * 길이(하의)는 기장마다 확연히 다르다.
   * 판정하지 않으면 하의는 기본값 'knee' 로 떨어져, 긴 바지가 무릎에서
   * 잘린 채로 입혀진다 — 실제로 그렇게 나왔다.
   * 기준값은 절차적 옷본이 아니라 **실물 옷의 비율**에서 잡았다. 옷본은
   * 어깨를 넓게 그린 양식화된 그림이라 기준으로 삼으면 한 단계씩 길게
   * 판정된다. */
  function pickBy(ratio, table) {
    for (var i = 0; i < table.length - 1; i++) if (ratio < table[i][1]) return table[i][0];
    return table[table.length - 1][0];
  }
  var HEM_RATIO_TOP = [['crop', 1.07], ['waist', 1.40], ['hip', 1.72], ['thigh', 2.15], ['knee', 9]];
  var HEM_RATIO_BOTTOM = [['thigh', 1.15], ['knee', 1.70], ['midi', 2.25], ['ankle', 9]];

  var SLEEVE_RATIO = {
    long:   { K: 0.210, R: 0.058 },
    threeq: { K: 0.126, R: 0.071 },
    short:  { K: 0.032, R: 0.301 },
    cap:    { K: -0.50, R: 0.330 }
  };

  function measureTop(mask, w, h) {
    var rows = rowScan(mask, w, h);
    var top = 0; while (top < h && rows[top].w === 0) top++;
    var bot = h - 1; while (bot > top && rows[bot].w === 0) bot--;
    var HH = bot - top;
    if (HH < h * 0.25) return null;

    /* 중심축 — 아래쪽 절반(소매가 없는 몸통)의 중앙값 */
    var cs = [];
    for (var y = top + Math.round(HH * 0.55); y <= bot; y++) {
      if (rows[y].core > 2) cs.push((rows[y].coreL + rows[y].coreR) / 2);
    }
    if (!cs.length) return null;
    cs.sort(function (a, b) { return a - b; });
    var cx = cs[cs.length >> 1];

    /* 어깨 — 맨 위 3% 지점의 폭. 그보다 위는 목선 때문에 좁다. */
    var shY = top + Math.max(1, Math.round(HH * 0.03));
    var shHalf = rows[shY].w / 2;
    if (!(shHalf > w * 0.04)) return null;

    /* 소매 끝 — 가장 바깥으로 나간 행 */
    var cuffY = shY, cuffOut = shHalf;
    for (var y2 = shY; y2 <= top + Math.round(HH * 0.90); y2++) {
      var half = rows[y2].w / 2;
      if (half > cuffOut) { cuffOut = half; cuffY = y2; }
    }

    /* 겨드랑이 — 소매와 몸통 사이에 배경이 들어오는 첫 행 */
    var armpitY = -1;
    for (var y3 = shY; y3 <= top + Math.round(HH * 0.90); y3++) {
      if (rows[y3].runs.length >= 2) { armpitY = y3; break; }
    }
    var sleeve;
    if (armpitY < 0 || armpitY >= cuffY) {
      /* 쐐기가 없다 = 민소매이거나 소매가 몸통에 붙게 찍힌 사진.
       * 소매를 따로 변형하지 않고 요크로 다룬다. */
      armpitY = top + Math.round(HH * 0.275);
      sleeve = 'none';
      cuffY = armpitY; cuffOut = shHalf * 0.90;
    } else {
      var t = (cuffY - top) / HH;
      sleeve = t < 0.24 ? 'cap' : t < 0.45 ? 'short' : t < 0.72 ? 'threeq' : 'long';
    }
    var sr = SLEEVE_RATIO[sleeve] || SLEEVE_RATIO.short;

    var hemY = bot - Math.max(1, Math.round(HH * 0.01));
    var chestY = shY + (hemY - shY) * 0.458;      // 옷본과 같은 자리
    var waistY = shY + (hemY - shY) * 0.649;
    function coreHalf(y) {
      var r = rows[Math.max(top, Math.min(bot, Math.round(y)))];
      return (r && r.core > 2 ? r.core : r.w) / 2;
    }
    var bodyHalf = coreHalf(chestY);
    var waistHalf = coreHalf(waistY);
    var hemHalf = coreHalf(hemY);
    if (!(bodyHalf > w * 0.03)) return null;

    /* 목선 — 가운데가 뚫려 있으면 그 구멍의 아래끝, 아니면 어깨 대비 비율.
     * (생성 이미지는 목선을 구멍이 아니라 그림으로 그리는 경우가 흔하다) */
    var neckY = -1, neckHalf = shHalf * 0.37;
    var cxi = Math.round(cx);
    for (var y4 = top; y4 <= top + Math.round(HH * 0.25); y4++) {
      if (!mask[y4 * w + cxi] && rows[y4].w > shHalf) neckY = y4;
    }
    if (neckY > top) {
      var l = cxi; while (l > 0 && !mask[neckY * w + l]) l--;
      var rr = cxi; while (rr < w - 1 && !mask[neckY * w + rr]) rr++;
      neckHalf = Math.max(w * 0.02, (rr - l) / 2);
    } else {
      neckY = top + Math.round(HH * 0.045);
    }

    return {
      cx: cx, neckHalf: neckHalf, neckY: neckY, shY: shY, shHalf: shHalf,
      armpitY: armpitY, bodyHalf: bodyHalf, chestY: chestY,
      waistHalf: waistHalf, waistY: waistY, hemHalf: hemHalf, hemY: hemY,
      sleeve: sleeve, cuffY: cuffY, cuffOut: cuffOut,
      cuffIn: shHalf + (cuffOut - shHalf) * sr.K,
      cuffInY: cuffY - (cuffY - armpitY) * sr.R,
      hem: pickBy((hemY - shY) / Math.max(1, shHalf * 2), HEM_RATIO_TOP),
      neck: 'crew'
    };
  }

  function measureBottom(mask, w, h) {
    var rows = rowScan(mask, w, h);
    var top = 0; while (top < h && rows[top].w === 0) top++;
    var bot = h - 1; while (bot > top && rows[bot].w === 0) bot--;
    var HH = bot - top;
    if (HH < h * 0.25) return null;

    var cs = [];
    for (var y = top; y <= top + Math.round(HH * 0.30); y++) {
      if (rows[y].w > 2) cs.push((rows[y].x0 + rows[y].x1) / 2);
    }
    if (!cs.length) return null;
    cs.sort(function (a, b) { return a - b; });
    var cx = cs[cs.length >> 1];

    var waistY = top + Math.max(1, Math.round(HH * 0.015));
    var waistHalf = rows[waistY].w / 2;
    var hipY = waistY, hipHalf = waistHalf;
    for (var y2 = waistY; y2 <= top + Math.round(HH * 0.45); y2++) {
      if (rows[y2].w / 2 > hipHalf) { hipHalf = rows[y2].w / 2; hipY = y2; }
    }
    var hemY = bot - Math.max(1, Math.round(HH * 0.01));

    /* 가랑이 — 두 다리로 갈라지는 첫 행. 없으면 치마다. */
    var crotchY = -1;
    for (var y3 = hipY; y3 <= bot; y3++) {
      if (rows[y3].runs.length >= 2) { crotchY = y3; break; }
    }
    var isSkirt = crotchY < 0;
    var legHalf = hipHalf * 0.46, taper = 1;
    if (!isSkirt) {
      /* 밑단에서 다리 하나의 바깥·안쪽을 그대로 읽는다.
       * 옷본이 바깥을 legHalf*(taper+.25), 안쪽을 legHalf*.35 로 두므로
       * 두 값에서 legHalf 와 taper 가 나온다 — 맞출 필요 없이 풀린다. */
      var hr = rows[Math.round(hemY)];
      var lft = null;
      for (var i = 0; i < hr.runs.length; i++) {
        if (hr.runs[i][1] < cx) { lft = hr.runs[i]; break; }
      }
      if (lft) {
        var outH = cx - lft[0], inH = cx - lft[1];
        if (inH > 1 && outH > inH) {
          legHalf = inH / 0.35;
          taper = outH / legHalf - 0.25;
        }
      }
      taper = Math.max(0.55, Math.min(1.45, taper));
      legHalf = Math.max(w * 0.03, Math.min(hipHalf * 0.85, legHalf));
    }

    return {
      cx: cx, waistY: waistY, waistHalf: waistHalf, hipY: hipY, hipHalf: hipHalf,
      crotchY: isSkirt ? hipY + (hemY - hipY) * 0.18 : crotchY,
      hemY: hemY, legHalf: legHalf, taper: taper, isSkirt: isSkirt,
      hem: pickBy((hemY - waistY) / Math.max(1, hipHalf * 2), HEM_RATIO_BOTTOM),
      flare: isSkirt ? Math.max(1.0, (rows[Math.round(hemY)].w / 2) / hipHalf) : 1.25,
      crotchDrop: HH * 0.06
    };
  }


  /* --- 사용자 옷 저장소 (IndexedDB) --------------------------------- */
  var DB_NAME = 'pc-wardrobe', STORE = 'items', _db = null, _userById = {};

  function openDB() {
    return new Promise(function (res, rej) {
      if (_db) return res(_db);
      if (!global.indexedDB) return rej(new Error('IndexedDB 미지원'));
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      rq.onsuccess = function () { _db = rq.result; res(_db); };
      rq.onerror = function () { rej(rq.error); };
    });
  }

  function saveUser(item) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(item);
        tx.oncomplete = function () { res(item); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  function listUser() {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readonly'), rq = tx.objectStore(STORE).getAll();
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function () { rej(rq.error); };
      });
    }).then(function (items) {
      return Promise.all(items.map(decodeItem));
    }).catch(function () { return []; });
  }

  /** 저장된 PNG를 화면에 쓸 픽셀로 되돌린다(예전 항목은 픽셀이 이미 있다) */
  function decodeItem(it) {
    if (!it || (it.pixels && it.pixels.length) || !it.png) return Promise.resolve(it);
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () {
        var cv = document.createElement('canvas');
        cv.width = it.w; cv.height = it.h;
        var c = cv.getContext('2d');
        c.clearRect(0, 0, it.w, it.h);
        c.drawImage(im, 0, 0);
        it.pixels = c.getImageData(0, 0, it.w, it.h).data;
        res(it);
      };
      im.onerror = function () { res(it); };
      im.src = it.png;
    });
  }

  function removeUser(id) {
    invalidate(id); delete _userById[id];
    return openDB().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = res; tx.onerror = res;
      });
    }).catch(function () {});
  }

  /** 반입한 옷을 카탈로그와 같은 형태로 되살린다 */
  function loadUserRender(g) {
    var cv = document.createElement('canvas');
    cv.width = g.w; cv.height = g.h;
    var ctx = cv.getContext('2d');
    var im = ctx.createImageData(g.w, g.h);
    im.data.set(new Uint8ClampedArray(g.pixels));
    ctx.putImageData(im, 0, 0);
    /* geom 이 비어 있으면 buildParts 가 몸통 폭을 0으로 보고 옷본 전체를
     * 한 열로 눌러 읽는다. 반입한 옷에도 옷본과 같은 geom 을 실어 준다.
     * (예전 반입본은 geom 이 없으므로 여기서 다시 재어 채운다) */
    var geom = g.geom;
    if (!geom || geom.bodyHalf == null) {
      var m = new Uint8Array(g.w * g.h);
      for (var i = 0, q = 3; i < m.length; i++, q += 4) m[i] = g.pixels[q] > 8 ? 1 : 0;
      var P2 = g.cat === 'bottom' ? measureBottom(m, g.w, g.h) : measureTop(m, g.w, g.h);
      if (P2) {
        var rebuilt = g.cat === 'bottom' ? bottomAnchorsOf(P2) : topAnchorsOf(P2);
        geom = rebuilt.geom;
        if (!g.anchors || !g.anchors.pitL) g.anchors = rebuilt.anchors;
      } else {
        geom = { cx: g.w / 2 };
      }
    }
    return { canvas: cv, anchors: g.anchors, geom: geom, material: MATERIALS[g.material] || MATERIALS.cotton };
  }

  /**
   * 사진 → 카탈로그 항목.
   *
   * 저장은 **PNG**로 한다. 예전에는 픽셀 배열을 통째로 넣었다 — "재인코딩
   * 손실이 없다"는 이유였는데, PNG는 무손실이므로 그 이유가 성립하지 않는다.
   * 그러면서 한 벌에 4.1MB를 먹었다. 옷 스무 벌이면 80MB다.
   * 어느 쪽이든 **이 브라우저 밖으로 나가지 않는다**는 약속은 그대로다.
   */
  function importPhoto(source, meta) {
    var cut = cutout(source, 560);
    if (cut.ratio < 0.03) throw new Error('옷을 배경에서 분리하지 못했습니다. 단색 배경의 상품 사진이 가장 잘 됩니다.');
    if (cut.ratio > 0.92) throw new Error('배경이 지워지지 않았습니다. 흰 배경 상품컷을 써 주세요.');
    var isBottom = meta.cat === 'bottom';
    var P = isBottom ? measureBottom(cut.mask, cut.w, cut.h)
                     : measureTop(cut.mask, cut.w, cut.h);
    if (!P) throw new Error('옷의 형태를 읽지 못했습니다. 옷을 펼쳐 놓고 정면에서 찍은 사진이 가장 잘 됩니다.');
    var built = isBottom ? bottomAnchorsOf(P) : topAnchorsOf(P);
    var px = cut.ctx.getImageData(0, 0, cut.w, cut.h).data;
    var item = {
      png: cut.canvas.toDataURL('image/png'),
      id: 'u-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36),
      ko: meta.ko || '내 옷', cat: meta.cat || 'top', style: meta.style || 'casual',
      material: meta.material || 'cotton', userPhoto: true,
      w: cut.w, h: cut.h, anchors: built.anchors, geom: built.geom,
      // 소매·기장 종류는 피팅 쪽에서 쓴다(소매 조각을 만들지 말지 등)
      sleeve: P.sleeve || null, hem: P.hem || null,
      shape: P.isSkirt ? 'skirt' : (isBottom ? 'pants' : null),
      createdAt: Date.now()
    };
    // 이번 세션에서는 방금 만든 픽셀을 그대로 쓴다(다시 디코딩할 이유가 없다)
    item.pixels = px;
    _userById[item.id] = item;
    return item;
  }

  function registerUser(items) {
    items.forEach(function (it) { _userById[it.id] = it; });
  }
  function userItems() {
    return Object.keys(_userById).map(function (k) { return _userById[k]; });
  }

  function all() { return CATALOG.concat(userItems()); }

  /**
   * 성별에 맞는 옷만 남긴다.
   *
   * 태그는 g:'f'(여성 전용) 하나뿐이고 나머지는 공용이다. 남성 전용을 따로
   * 두지 않은 이유는, 이 카탈로그에서 남성만 입는 아이템이 실제로 없기
   * 때문이다 — 없는 구분을 만들면 여성 사용자에게서 셔츠·슬랙스를 빼앗는다.
   * '구분 없이'를 고른 사용자에게는 전부 보여준다.
   */
  function forGender(list, gender) {
    if (gender !== 'male') return list;
    // 사용자가 직접 넣은 옷은 거르지 않는다 — 본인이 가진 옷이다
    return list.filter(function (g) { return g && (g.userPhoto || g.g !== 'f'); });
  }
  function byId(id) { return BY_ID[id] || _userById[id] || null; }

  global.GARMENTS = {
    CATALOG: CATALOG, STYLES: STYLES, CATS: CATS, MATERIALS: MATERIALS,
    NECK: NECK, W: BASE_W, H: BASE_H, HEM_Y: HEM_Y, HEM_Y_B: HEM_Y_B,
    all: all, forGender: forGender, byId: byId, get: get, invalidate: invalidate,
    render: renderGarment, cutout: cutout,
    measureTop: measureTop, measureBottom: measureBottom,
    topAnchorsOf: topAnchorsOf, bottomAnchorsOf: bottomAnchorsOf,
    thumb: thumb,
    importPhoto: importPhoto, saveUser: saveUser, listUser: listUser,
    removeUser: removeUser, registerUser: registerUser, userItems: userItems
  };
})(window);
