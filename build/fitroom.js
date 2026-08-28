/* =========================================================================
 * fitroom.js — 가상 피팅 화면
 *
 * 리포트의 "코디" 탭은 색과 아이템 이름을 알려준다. 그것만으로는
 * 사용자가 상상해야 한다. 이 탭은 상상하지 않게 만든다 —
 * **자기 전신 사진에 그 색의 그 옷을 실제로 얹어서** 보여준다.
 *
 * 화면 구조는 이 도구의 다른 인터랙션(드레이핑 스튜디오)과 같은 원칙이다.
 *   · 클릭 한 번에 결과가 바뀐다 (설명은 그 다음)
 *   · 원본과 즉시 비교할 수 있다 (와이프 슬라이더)
 *   · 자동 결과는 초안이고 손으로 고칠 수 있다 (여유분·기장·위치)
 * ========================================================================= */
(function (global) {
  'use strict';

  var esc = function (s) { return REPORT.esc(s); };
  var clamp = CC.clamp;

  var S = null;   // 화면 상태

  /* =======================================================================
   * 1. 마크업
   * ===================================================================== */
  function panelHTML(ctx) {
    var cats = [
      { k: 'top', ko: '상의' }, { k: 'outer', ko: '아우터' },
      { k: 'bottom', ko: '하의' }, { k: 'dress', ko: '원피스' }
    ];
    var styles = Object.keys(GARMENTS.STYLES);

    return '' +
    '<div class="card">' +
      '<h2>가상 피팅</h2>' +
      '<p class="sub">진단된 팔레트의 색을 <b>당신의 전신 사진</b>에 실제로 입혀 봅니다. ' +
      '옷은 몸의 어깨·허리·골반 위치에 맞춰 변형되고, 사진에 든 빛을 그대로 다시 받습니다. ' +
      '모든 처리는 이 브라우저 안에서 끝납니다.</p>' +

      (ctx.hasBody ? '' :
        '<div class="note warn"><span class="ic">!</span><span>전신 사진이 없어 피팅을 할 수 없습니다. ' +
        '3단계로 돌아가 전신 사진을 올려 주세요.</span></div>') +

      (ctx.hasBody ?
      '<div class="fit-wrap">' +
        '<div class="fit-left">' +
          '<div class="fit-stage" id="fitStage">' +
            '<canvas id="fitCanvas" aria-label="가상 피팅 결과"></canvas>' +
            '<div class="fit-wipe" id="fitWipeLine"></div>' +
            '<div class="fit-tagl">원본</div><div class="fit-tagr">피팅</div>' +
            '<div class="fit-spin hidden" id="fitSpin"><span></span></div>' +
          '</div>' +
          '<input type="range" id="fitWipe" min="0" max="100" value="100" ' +
            'aria-label="원본과 피팅 결과 비교" class="fit-range">' +
          '<div class="fit-hint hint">손잡이를 좌우로 밀면 원본과 겹쳐 볼 수 있습니다.</div>' +

          '<div class="fit-sliders">' +
            '<label class="fit-sl"><span>여유분</span>' +
              '<input type="range" id="fitEase" min="88" max="128" value="100">' +
              '<b id="fitEaseV">보통</b></label>' +
            '<label class="fit-sl"><span>기장</span>' +
              '<input type="range" id="fitLen" min="-60" max="60" value="0">' +
              '<b id="fitLenV">기본</b></label>' +
            '<label class="fit-sl"><span>위치</span>' +
              '<input type="range" id="fitShift" min="-40" max="40" value="0">' +
              '<b id="fitShiftV">기본</b></label>' +
            '<label class="fit-sl"><span>빛 이식</span>' +
              '<input type="range" id="fitLight" min="0" max="100" value="75">' +
              '<b id="fitLightV">75%</b></label>' +
          '</div>' +
          '<label class="fit-check"><input type="checkbox" id="fitErase" checked> ' +
            '원래 입은 옷 지우기 <span class="hint">(드러난 부분은 주변 색으로 메웁니다)</span></label>' +

          '<div class="btn-row" style="margin-top:12px">' +
            '<button class="btn" id="fitClear">모두 벗기</button>' +
            '<button class="btn primary" id="fitSave">이미지로 저장</button>' +
          '</div>' +
          '<div id="fitReport"></div>' +
        '</div>' +

        '<div class="fit-right">' +
          '<div class="seg-row"><span class="seg-label">부위</span>' +
            '<div class="seg" id="fitCatSeg">' +
              cats.map(function (c, i) {
                return '<button class="seg-btn' + (i === 0 ? ' on' : '') + '" data-cat="' + c.k + '">' +
                  c.ko + '</button>';
              }).join('') + '</div></div>' +

          '<div class="fit-styles" id="fitStyleRow">' +
            '<button class="chip on" data-style="">전체</button>' +
            styles.map(function (k) {
              return '<button class="chip" data-style="' + k + '">' +
                esc(GARMENTS.STYLES[k].ko) + '</button>';
            }).join('') + '</div>' +

          '<div class="fit-grid" id="fitGrid"></div>' +

          '<div class="fit-colors" id="fitColorBox"></div>' +

          '<div class="fit-mat" id="fitMatBox"></div>' +

          '<div class="fit-import">' +
            '<button class="btn" id="fitImport">내 옷 사진 추가</button>' +
            '<input type="file" id="fitImportFile" accept="image/*" class="hidden" tabindex="-1">' +
            '<p class="hint">흰 배경 상품컷이 가장 잘 됩니다. 배경을 자동으로 지우고 ' +
            '이 브라우저에만 저장합니다 — 어디로도 전송되지 않습니다.</p>' +
          '</div>' +
          '<div id="fitImportPanel"></div>' +
        '</div>' +
      '</div>' : '') +

      '<details class="detail-box" style="margin-top:18px"><summary>이 피팅은 어떻게 만들어지나 · 무엇을 믿으면 안 되나</summary>' +
        '<p class="hint">상용 가상 피팅과 같은 순서(옷 지우기 → 변형 → 합성)를 따르되, ' +
        '마지막 <b>생성 모델 다듬기</b> 단계만 물리적 규칙으로 대체했습니다. ' +
        '그 단계가 GPU 서버와 수 GB 모델을 요구하는 유일한 부분이고, ' +
        '그것을 넣으면 사진을 서버로 보내야 하기 때문입니다.</p>' +
        '<ul class="guide-list">' +
        '<li><span class="ic">1</span><span><b>옷 변형</b> — 어깨·소매·허리·밑단 10개 대응점을 ' +
        'Thin-Plate Spline으로 잇습니다. 대응점 사이의 천은 휘어짐 에너지가 최소가 되도록 따라옵니다.</span></li>' +
        '<li><span class="ic">2</span><span><b>빛 이식</b> — 사진을 크게 흐려 조명장을 뽑고 옷에 다시 곱합니다. ' +
        '왼쪽에서 빛이 든 사진이면 옷의 왼쪽도 밝아집니다. 이것이 "붙여넣기"처럼 보이지 않게 하는 핵심입니다.</span></li>' +
        '<li><span class="ic">3</span><span><b>색 변환</b> — 픽셀을 "옷 색 × 닿은 빛"으로 분해해 ' +
        '음영 비율은 남기고 색 성분만 갈아끼웁니다. 그늘과 하이라이트에서 채도를 빼고, ' +
        '광택 소재는 하이라이트를 물들이지 않습니다.</span></li>' +
        '<li class="no"><span class="ic">🚫</span><span>정면 사진 한 장에서 몸의 <b>앞뒤 두께</b>는 알 수 없습니다. ' +
        '옷은 실루엣 폭에만 맞춰집니다.</span></li>' +
        '<li class="no"><span class="ic">🚫</span><span>원래 옷이 새 옷보다 크면 드러나는 부분을 ' +
        '<b>복원할 수 없습니다.</b> 주변 색으로 메우고 그 면적을 보고합니다.</span></li>' +
        '<li class="no"><span class="ic">🚫</span><span>팔짱·주머니에 넣은 손처럼 복잡한 가림은 처리하지 못합니다.</span></li>' +
        '</ul></details>' +
    '</div>';
  }

  /* =======================================================================
   * 2. 마운트
   * ===================================================================== */
  function mount(root, ctx) {
    // .tab-panel 을 반드시 명시한다. 탭 **버튼**에도 같은 data-panel 이 있고
    // DOM에서 먼저 나오기 때문에, 클래스를 빼면 패널이 아니라 버튼 안에
    // 화면 전체가 그려진다.
    var host = root.querySelector('.tab-panel[data-panel="tryon"]');
    if (!host || host.dataset.mounted === '1') return;
    host.dataset.mounted = '1';
    host.innerHTML = panelHTML(ctx);
    if (!ctx.hasBody) return;

    S = {
      root: host, ctx: ctx,
      body: null, base: null,
      layers: { bottom: null, top: null, outer: null, dress: null },
      cat: 'top', style: '',
      ease: 1, lengthAdj: 0, shiftY: 0, lightAmount: 0.75, erase: true,
      wipe: 1, busy: false, pending: false
    };

    /* 저장된 내 옷 복원 */
    GARMENTS.listUser().then(function (items) {
      if (items && items.length) { GARMENTS.registerUser(items); renderGrid(); }
    });

    wire(host);
    renderGrid();
    renderColors();
    renderMaterial();

    /* 무거운 준비는 한 번만 */
    setTimeout(function () {
      try {
        S.body = TRYON.prepare(ctx.body, ctx.sourceImage, 900);
      } catch (e) { S.body = null; }
      if (!S.body) {
        host.querySelector('#fitStage').innerHTML =
          '<div class="fit-fail">전신 사진에서 몸의 위치를 잡지 못했습니다. ' +
          '단색 배경에서 머리부터 발끝까지 나오게 다시 촬영해 주세요.</div>';
        return;
      }
      S.base = S.body.image;
      /* 첫 화면은 추천 코디의 상의를 이미 입혀 둔다 — 빈 화면은 아무것도 알려주지 않는다 */
      var seed = suggestSeed(ctx);
      if (seed) { S.layers.top = seed.top; S.layers.bottom = seed.bottom; }
      syncSelection();
      recompose();
    }, 30);
  }

  /** 진단 결과에서 첫 착장을 고른다 */
  function suggestSeed(ctx) {
    var pal = TRYON.paletteFor(ctx.dx, ctx.rec, 'top');
    var palB = TRYON.paletteFor(ctx.dx, ctx.rec, 'bottom');
    if (!pal.length) return null;
    var gender = ctx.rec && ctx.rec.gender;
    var topId = gender === 'male' ? 't-shirt-oxford' : 't-crew-cotton';
    return {
      top: { garmentId: topId, colorHex: pal[0].hex, colorKo: pal[0].ko },
      bottom: { garmentId: 'b-straight-denim', colorHex: (palB[0] || pal[0]).hex, colorKo: (palB[0] || pal[0]).ko }
    };
  }

  /* =======================================================================
   * 3. 이벤트 배선
   * ===================================================================== */
  function wire(host) {
    var q = function (s) { return host.querySelector(s); };

    q('#fitCatSeg').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn'); if (!b) return;
      Array.prototype.forEach.call(this.querySelectorAll('.seg-btn'), function (x) {
        x.classList.toggle('on', x === b);
      });
      S.cat = b.dataset.cat;
      renderGrid(); renderColors(); renderMaterial();
    });

    q('#fitStyleRow').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      Array.prototype.forEach.call(this.querySelectorAll('.chip'), function (x) {
        x.classList.toggle('on', x === b);
      });
      S.style = b.dataset.style || '';
      renderGrid();
    });

    q('#fitGrid').addEventListener('click', function (e) {
      var del = e.target.closest('.fit-del');
      if (del) {
        e.stopPropagation();
        var did = del.parentNode.dataset.id;
        GARMENTS.removeUser(did).then(function () {
          Object.keys(S.layers).forEach(function (k) {
            if (S.layers[k] && S.layers[k].garmentId === did) S.layers[k] = null;
          });
          renderGrid(); recompose();
        });
        return;
      }
      var it = e.target.closest('.fit-item'); if (!it) return;
      pickGarment(it.dataset.id);
    });

    q('#fitColorBox').addEventListener('click', function (e) {
      var sw = e.target.closest('.fit-sw'); if (!sw) return;
      var slot = activeSlot();
      if (!S.layers[slot]) return;
      S.layers[slot].colorHex = sw.dataset.hex;
      S.layers[slot].colorKo = sw.dataset.ko;
      renderColors(); recompose();
    });

    q('#fitMatBox').addEventListener('change', function (e) {
      if (e.target.id !== 'fitMatSel') return;
      var slot = activeSlot();
      if (!S.layers[slot]) return;
      S.layers[slot].material = e.target.value || null;
      recompose();
    });

    var EASE_KO = [[92, '타이트'], [98, '슬림'], [106, '보통'], [116, '루즈'], [999, '오버사이즈']];
    bindRange(q('#fitEase'), q('#fitEaseV'), function (v) {
      S.ease = v / 100;
      for (var i = 0; i < EASE_KO.length; i++) if (v <= EASE_KO[i][0]) return EASE_KO[i][1];
      return '보통';
    });
    bindRange(q('#fitLen'), q('#fitLenV'), function (v) {
      S.lengthAdj = v * (S.body ? S.body.h / 900 : 1);
      return v === 0 ? '기본' : (v > 0 ? '+' : '') + v;
    });
    bindRange(q('#fitShift'), q('#fitShiftV'), function (v) {
      S.shiftY = v * (S.body ? S.body.h / 900 : 1);
      return v === 0 ? '기본' : (v > 0 ? '↓' : '↑') + Math.abs(v);
    });
    bindRange(q('#fitLight'), q('#fitLightV'), function (v) {
      S.lightAmount = v / 100; return v + '%';
    });

    q('#fitErase').addEventListener('change', function () {
      S.erase = this.checked; recompose();
    });

    /* 와이프는 재합성 없이 그리기만 다시 한다 — 즉시 반응해야 비교가 된다 */
    q('#fitWipe').addEventListener('input', function () {
      S.wipe = +this.value / 100; paint();
    });

    q('#fitClear').addEventListener('click', function () {
      S.layers = { bottom: null, top: null, outer: null, dress: null };
      syncSelection(); recompose();
    });
    q('#fitSave').addEventListener('click', saveImage);

    q('#fitImport').addEventListener('click', function () { q('#fitImportFile').click(); });
    q('#fitImportFile').addEventListener('change', function () {
      if (this.files && this.files[0]) openImport(this.files[0]);
      this.value = '';
    });
  }

  function bindRange(input, label, fn) {
    var t = null;
    function apply(live) {
      label.textContent = fn(+input.value);
      if (t) clearTimeout(t);
      // 슬라이더는 초당 수십 번 바뀐다. 매번 합성하면 화면이 멈춘다.
      t = setTimeout(recompose, live ? 130 : 0);
    }
    input.addEventListener('input', function () { apply(true); });
    label.textContent = fn(+input.value);
  }

  /** 지금 조작 대상인 슬롯 */
  function activeSlot() {
    if (S.cat === 'dress') return 'dress';
    if (S.cat === 'outer') return 'outer';
    if (S.cat === 'bottom') return 'bottom';
    return 'top';
  }

  function pickGarment(id) {
    var slot = activeSlot();
    var cur = S.layers[slot];
    if (cur && cur.garmentId === id) { S.layers[slot] = null; }   // 다시 누르면 벗는다
    else {
      var pal = TRYON.paletteFor(S.ctx.dx, S.ctx.rec, S.cat);
      var keep = cur && cur.colorHex;
      S.layers[slot] = {
        garmentId: id,
        colorHex: keep || (pal[0] ? pal[0].hex : null),
        colorKo: keep ? cur.colorKo : (pal[0] ? pal[0].ko : ''),
        material: cur ? cur.material : null
      };
      // 원피스와 상하의는 동시에 입을 수 없다
      if (slot === 'dress') { S.layers.top = null; S.layers.bottom = null; }
      else if (slot === 'top' || slot === 'bottom') S.layers.dress = null;
    }
    syncSelection(); renderColors(); renderMaterial(); recompose();
  }

  /* =======================================================================
   * 4. 목록 · 색 · 소재
   * ===================================================================== */
  function renderGrid() {
    var grid = S.root.querySelector('#fitGrid');
    var items = GARMENTS.all().filter(function (g) {
      if (g.cat !== S.cat) return false;
      if (S.style && g.style !== S.style) return false;
      return true;
    });
    if (!items.length) {
      grid.innerHTML = '<p class="hint" style="grid-column:1/-1">이 조건에 맞는 옷이 없습니다.</p>';
      return;
    }
    grid.innerHTML = items.map(function (g) {
      var slot = activeSlot();
      var on = S.layers[slot] && S.layers[slot].garmentId === g.id;
      return '<button class="fit-item' + (on ? ' on' : '') + '" data-id="' + g.id + '" ' +
        'title="' + esc(g.ko) + '">' +
        '<span class="fit-thumb"></span>' +
        '<span class="fit-name">' + esc(g.ko) + '</span>' +
        '<span class="fit-style">' + esc((GARMENTS.STYLES[g.style] || {}).ko || '') +
          ' · ' + esc((GARMENTS.MATERIALS[g.material] || {}).ko || '') + '</span>' +
        (g.userPhoto ? '<span class="fit-del" title="삭제">×</span>' : '') +
        '</button>';
    }).join('');

    /* 썸네일은 보일 때 그린다 — 40벌을 한꺼번에 그리면 탭이 멈춘다 */
    var pend = Array.prototype.slice.call(grid.querySelectorAll('.fit-item'));
    var io = ('IntersectionObserver' in global) ? new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        drawThumb(en.target); io.unobserve(en.target);
      });
    }, { root: null, rootMargin: '200px' }) : null;
    pend.forEach(function (el) { if (io) io.observe(el); else drawThumb(el); });
  }

  function drawThumb(el) {
    if (el.dataset.drawn === '1') return;
    el.dataset.drawn = '1';
    var cv = GARMENTS.thumb(el.dataset.id, 128);
    if (!cv) return;
    var box = el.querySelector('.fit-thumb');
    var c2 = document.createElement('canvas');
    c2.width = cv.width; c2.height = cv.height;
    c2.getContext('2d').drawImage(cv, 0, 0);
    box.appendChild(c2);
  }

  function renderColors() {
    var box = S.root.querySelector('#fitColorBox');
    var slot = activeSlot(), layer = S.layers[slot];
    var pal = TRYON.paletteFor(S.ctx.dx, S.ctx.rec, S.cat);
    if (!pal.length) { box.innerHTML = ''; return; }
    var near = (S.cat === 'top' || S.cat === 'outer' || S.cat === 'dress');
    box.innerHTML =
      '<h4 class="fit-h">색 <span class="hint">' +
        (near ? '얼굴 옆이라 베스트 컬러에서만 고릅니다' : '얼굴에서 머니 자유도가 높습니다') +
      '</span></h4>' +
      '<div class="fit-sws">' + pal.slice(0, 12).map(function (c) {
        var on = layer && layer.colorHex === c.hex;
        return '<button class="fit-sw' + (on ? ' on' : '') + '" data-hex="' + c.hex + '" ' +
          'data-ko="' + esc(c.ko || '') + '" style="background:' + c.hex + '" ' +
          'title="' + esc(c.ko || c.hex) + '"><span>' + esc(c.ko || '') + '</span></button>';
      }).join('') + '</div>' +
      (layer ? '' : '<p class="hint">먼저 옷을 고르세요.</p>');
  }

  function renderMaterial() {
    var box = S.root.querySelector('#fitMatBox');
    var slot = activeSlot(), layer = S.layers[slot];
    if (!layer) { box.innerHTML = ''; return; }
    var spec = GARMENTS.byId(layer.garmentId);
    var keys = Object.keys(RECOLOR.PROFILES);
    box.innerHTML =
      '<h4 class="fit-h">소재 <span class="hint">색이 빛에 어떻게 반응할지가 달라집니다</span></h4>' +
      '<select id="fitMatSel" class="fit-sel">' +
      '<option value="">자동 (' + esc((GARMENTS.MATERIALS[spec.material] || {}).ko || '면') + ')</option>' +
      keys.map(function (k) {
        return '<option value="' + k + '"' + (layer.material === k ? ' selected' : '') + '>' +
          esc(RECOLOR.PROFILES[k].ko) + '</option>';
      }).join('') + '</select>';
  }

  function syncSelection() {
    var slot = activeSlot();
    Array.prototype.forEach.call(S.root.querySelectorAll('.fit-item'), function (el) {
      el.classList.toggle('on', !!(S.layers[slot] && S.layers[slot].garmentId === el.dataset.id));
    });
  }

  /* =======================================================================
   * 5. 합성 · 그리기
   * ===================================================================== */
  function layerOrder() {
    var out = [];
    if (S.layers.dress) out.push(S.layers.dress);
    else {
      if (S.layers.bottom) out.push(S.layers.bottom);
      if (S.layers.top) out.push(S.layers.top);
    }
    if (S.layers.outer) out.push(S.layers.outer);
    return out;
  }

  function recompose() {
    if (!S || !S.body) return;
    if (S.busy) { S.pending = true; return; }
    S.busy = true;
    var spin = S.root.querySelector('#fitSpin');
    if (spin) spin.classList.remove('hidden');

    // 렌더를 다음 프레임으로 미뤄야 스피너가 실제로 보인다
    requestAnimationFrame(function () { setTimeout(function () {
      var res;
      try {
        res = TRYON.compose(S.body, layerOrder(), {
          ease: S.ease, lengthAdj: S.lengthAdj, shiftY: S.shiftY,
          lightAmount: S.lightAmount, eraseOriginal: S.erase
        });
      } catch (e) {
        res = null;
        S.root.querySelector('#fitReport').innerHTML =
          '<div class="note fatal"><span class="ic">!</span><span>합성 중 오류가 났습니다: ' +
          esc(e.message) + '</span></div>';
      }
      if (res) { S.result = res.imageData; renderReport(res.report); paint(); }
      if (spin) spin.classList.add('hidden');
      S.busy = false;
      if (S.pending) { S.pending = false; recompose(); }
    }, 0); });
  }

  function paint() {
    var cv = S.root.querySelector('#fitCanvas');
    if (!cv || !S.body) return;
    var w = S.body.w, h = S.body.h;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var ctx = cv.getContext('2d');
    ctx.putImageData(S.base, 0, 0);
    if (S.result) {
      var cut = Math.round(w * S.wipe);
      if (cut > 0) ctx.putImageData(S.result, 0, 0, 0, 0, cut, h);
    }
    var line = S.root.querySelector('#fitWipeLine');
    if (line) {
      line.style.left = (S.wipe * 100) + '%';
      line.style.opacity = (S.wipe > 0.995 || S.wipe < 0.005) ? '0' : '1';
    }
  }

  /* =======================================================================
   * 6. 결과 보고 — 무엇이 잘 됐고 무엇이 안 됐는지 숨기지 않는다
   * ===================================================================== */
  function renderReport(rep) {
    var box = S.root.querySelector('#fitReport');
    if (!rep || !rep.layers.length) {
      box.innerHTML = '<p class="hint" style="margin-top:12px">옷을 고르면 여기에 변환 결과가 표시됩니다.</p>';
      return;
    }
    var h = '<div class="fit-rep">';
    rep.layers.forEach(function (L) {
      var v = L.recolor && L.recolor.verify;
      h += '<div class="fit-rep-row">' +
        '<span class="fit-rep-sw" style="background:' + (L.colorHex || '#ccc') + '"></span>' +
        '<b>' + esc(L.ko) + '</b>';
      if (v) {
        var keepPct = Math.round(clamp(v.textureKeep, 0, 1.2) * 100);
        var hit = v.hitDeltaE;
        h += '<span class="fit-rep-tags">' +
          '<span class="pill' + (hit < 4 ? ' ok' : hit < 9 ? '' : ' bad') + '">목표색 오차 ΔE ' +
            hit.toFixed(1) + '</span>' +
          '<span class="pill' + (keepPct > 70 ? ' ok' : '') + '">질감 보존 ' + keepPct + '%</span>' +
          '<span class="pill">소재 ' + esc((RECOLOR.PROFILES[L.recolor.material] || {}).ko || '—') + '</span>' +
          (L.recolor.clusters && L.recolor.clusters.length > 1
            ? '<span class="pill">색 ' + L.recolor.clusters.length + '개 군집</span>' : '') +
          '</span>';
      }
      h += '</div>';
    });
    h += '</div>';

    if (rep.warnings && rep.warnings.length) {
      h += rep.warnings.map(function (w) {
        return '<div class="note warn"><span class="ic">!</span><span>' + esc(w) + '</span></div>';
      }).join('');
    }
    h += '<p class="hint"><b>목표색 오차</b>는 "요청한 색"과 "실제로 나온 평균색"의 거리입니다. ' +
      '검은 가죽을 노랑으로 바꾸면 재질상 그만큼 밝아지지 않아 오차가 커집니다 — 실패가 아니라 ' +
      '그 소재에서 그 색이 그렇게 보인다는 뜻입니다. <b>질감 보존</b>은 변환 뒤에도 주름의 ' +
      '명암 폭이 얼마나 남았는지이며, 100%에 가까울수록 옷감처럼 보입니다.</p>';
    box.innerHTML = h;
  }

  /* =======================================================================
   * 7. 저장
   * ===================================================================== */
  function saveImage() {
    var cv = S.root.querySelector('#fitCanvas'); if (!cv) return;
    var out = document.createElement('canvas');
    out.width = cv.width; out.height = cv.height;
    var ctx = out.getContext('2d');
    ctx.putImageData(S.result || S.base, 0, 0);
    out.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '가상피팅-' + (S.ctx.dx && S.ctx.dx.type ? S.ctx.dx.type.key : 'look') + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }, 'image/png');
  }

  /* =======================================================================
   * 8. 내 옷 반입 — 자동 앵커는 초안이고, 손으로 고칠 수 있다
   * ===================================================================== */
  var IMP = null;

  function openImport(file) {
    var panel = S.root.querySelector('#fitImportPanel');
    panel.innerHTML = '<p class="hint">사진을 읽는 중…</p>';
    loadImage(file).then(function (img) {
      var cat = S.cat === 'dress' ? 'dress' : S.cat;
      var item;
      try {
        item = GARMENTS.importPhoto(img, { cat: cat, ko: '내 옷', style: 'casual', material: 'cotton' });
      } catch (e) {
        panel.innerHTML = '<div class="note fatal"><span class="ic">!</span><span>' + esc(e.message) + '</span></div>';
        return;
      }
      IMP = { item: item, drag: null };
      panel.innerHTML =
        '<div class="fit-imp">' +
          '<h4 class="fit-h">배경을 지웠습니다 — 점 위치를 확인해 주세요</h4>' +
          '<div class="fit-imp-stage"><canvas id="impCv"></canvas></div>' +
          '<p class="hint">파란 점은 <b>어깨 · 소매끝 · 허리 · 밑단</b>입니다. ' +
          '이 점이 몸의 같은 위치로 이동합니다. 어긋나 있으면 끌어서 고치세요.</p>' +
          '<div class="form fit-imp-form">' +
            '<div class="field"><label for="impKo">이름</label><div class="fc">' +
              '<input type="text" id="impKo" value="내 옷" maxlength="24"></div></div>' +
            '<div class="field"><label for="impCat">부위</label><div class="fc">' +
              '<select id="impCat">' +
                ['top', 'outer', 'bottom', 'dress'].map(function (k) {
                  return '<option value="' + k + '"' + (k === cat ? ' selected' : '') + '>' +
                    esc(GARMENTS.CATS[k].ko) + '</option>';
                }).join('') + '</select></div></div>' +
            '<div class="field"><label for="impStyle">스타일</label><div class="fc">' +
              '<select id="impStyle">' + Object.keys(GARMENTS.STYLES).map(function (k) {
                return '<option value="' + k + '">' + esc(GARMENTS.STYLES[k].ko) + '</option>';
              }).join('') + '</select></div></div>' +
            '<div class="field"><label for="impMat">소재</label><div class="fc">' +
              '<select id="impMat">' + Object.keys(GARMENTS.MATERIALS).map(function (k) {
                return '<option value="' + k + '">' + esc(GARMENTS.MATERIALS[k].ko) + '</option>';
              }).join('') + '</select></div></div>' +
          '</div>' +
          '<div class="btn-row end"><button class="btn" id="impCancel">취소</button>' +
          '<button class="btn primary" id="impSave">옷장에 넣기</button></div>' +
        '</div>';
      drawImport();
      wireImport(panel);
    }).catch(function (e) {
      panel.innerHTML = '<div class="note fatal"><span class="ic">!</span><span>파일을 읽지 못했습니다: ' +
        esc(e.message) + '</span></div>';
    });
  }

  function impKeys() {
    return IMP.item.cat === 'bottom' ? TRYON.KEYS_BOTTOM : TRYON.KEYS_TOP;
  }

  function drawImport() {
    var cv = S.root.querySelector('#impCv'); if (!cv || !IMP) return;
    var it = IMP.item;
    var maxW = 300, sc = Math.min(1, maxW / it.w);
    cv.width = Math.round(it.w * sc); cv.height = Math.round(it.h * sc);
    var ctx = cv.getContext('2d');
    var src = GARMENTS.get(it.id);
    ctx.clearRect(0, 0, cv.width, cv.height);
    // 체크무늬 배경 — 알파가 제대로 뚫렸는지 눈으로 확인할 수 있어야 한다
    var g = 8;
    for (var y = 0; y < cv.height; y += g) for (var x = 0; x < cv.width; x += g) {
      ctx.fillStyle = ((x / g + y / g) % 2) ? '#e9e9ec' : '#fafafc';
      ctx.fillRect(x, y, g, g);
    }
    ctx.drawImage(src.canvas, 0, 0, cv.width, cv.height);
    IMP.scale = sc;
    impKeys().forEach(function (k) {
      var p = it.anchors[k]; if (!p) return;
      ctx.beginPath(); ctx.arc(p[0] * sc, p[1] * sc, 6, 0, 6.284);
      ctx.fillStyle = 'rgba(0,122,255,.92)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    });
  }

  function wireImport(panel) {
    var cv = panel.querySelector('#impCv');
    function pos(e) {
      var r = cv.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return [(t.clientX - r.left) / IMP.scale, (t.clientY - r.top) / IMP.scale];
    }
    function down(e) {
      var p = pos(e), best = null, bd = 1e9;
      impKeys().forEach(function (k) {
        var a = IMP.item.anchors[k]; if (!a) return;
        var d = Math.hypot(a[0] - p[0], a[1] - p[1]);
        if (d < bd) { bd = d; best = k; }
      });
      if (best && bd < 26 / IMP.scale) { IMP.drag = best; e.preventDefault(); }
    }
    function move(e) {
      if (!IMP.drag) return;
      var p = pos(e);
      IMP.item.anchors[IMP.drag] = [clamp(p[0], 0, IMP.item.w), clamp(p[1], 0, IMP.item.h)];
      drawImport(); e.preventDefault();
    }
    function up() { IMP.drag = null; }
    cv.addEventListener('mousedown', down); cv.addEventListener('touchstart', down, { passive: false });
    global.addEventListener('mousemove', move); cv.addEventListener('touchmove', move, { passive: false });
    global.addEventListener('mouseup', up); cv.addEventListener('touchend', up);

    panel.querySelector('#impCat').addEventListener('change', function () {
      IMP.item.cat = this.value;
      IMP.item.anchors = GARMENTS.estimateAnchors(rebuildMask(IMP.item), IMP.item.w, IMP.item.h, this.value)
        || IMP.item.anchors;
      drawImport();
    });
    panel.querySelector('#impCancel').onclick = function () { panel.innerHTML = ''; IMP = null; };
    panel.querySelector('#impSave').onclick = function () {
      var it = IMP.item;
      it.ko = panel.querySelector('#impKo').value.trim() || '내 옷';
      it.cat = panel.querySelector('#impCat').value;
      it.style = panel.querySelector('#impStyle').value;
      it.material = panel.querySelector('#impMat').value;
      GARMENTS.invalidate(it.id);
      GARMENTS.saveUser(it).then(function () {
        panel.innerHTML = '<div class="note info"><span class="ic">✓</span><span>' +
          esc(it.ko) + ' 을(를) 옷장에 넣었습니다. 이 브라우저에만 저장됩니다.</span></div>';
        S.cat = it.cat;
        Array.prototype.forEach.call(S.root.querySelectorAll('#fitCatSeg .seg-btn'), function (b) {
          b.classList.toggle('on', b.dataset.cat === it.cat);
        });
        renderGrid();
        IMP = null;
      }).catch(function (e) {
        panel.innerHTML = '<div class="note warn"><span class="ic">!</span><span>' +
          '저장하지 못했습니다(' + esc(e.message) + '). 이번 세션에서는 쓸 수 있습니다.</span></div>';
        renderGrid(); IMP = null;
      });
    };
  }

  function rebuildMask(it) {
    var m = new Uint8Array(it.w * it.h);
    for (var p = 0; p < m.length; p++) m[p] = it.pixels[p * 4 + 3] > 8 ? 1 : 0;
    return m;
  }

  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('이미지 형식을 읽을 수 없습니다')); };
      img.src = url;
    });
  }

  global.FITROOM = { mount: mount, panelHTML: panelHTML };
})(window);
