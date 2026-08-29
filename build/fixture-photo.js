/* 사용자가 보내 준 실제 사진을 그대로 옮긴 픽스처.
 *
 * 지금까지 쓴 픽스처와 결정적으로 다른 점이 넷이고, 그 넷이 전부
 * 실패의 후보다.
 *   ① 배경이 순백이고 경계가 부드럽다 (배경 제거된 사진)
 *   ② 상의와 하의가 **같은 남색** — 옷 구간으로 둘을 나눌 수 없다
 *   ③ 반바지 아래가 맨다리·맨발이고, 발이 벌어져 실루엣 맨 아래가 넓다
 *   ④ 팔이 몸에 붙어 내려오다 팔꿈치 아래에서만 떨어진다
 */
function person() {
  const W = 1240, H = 2000;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H);

  const cx = 620;
  const NAVY = '#2A2F38', NAVY_D = '#1E222A';
  const SKIN = '#E8C4A0', SKIN_D = '#CDA57F';
  const HAIR = '#191410';

  // 머리 · 목
  c.fillStyle = SKIN;
  c.beginPath(); c.ellipse(cx, 300, 118, 152, 0, 0, 7); c.fill();
  c.fillStyle = HAIR;
  c.beginPath(); c.ellipse(cx, 236, 122, 104, 0, Math.PI, 0); c.fill();
  c.fillStyle = SKIN; c.fillRect(cx - 62, 405, 124, 70);

  // 팔 — 어깨에서 손끝까지. 위팔은 몸통에 닿고 아래팔부터 떨어진다.
  [-1, 1].forEach(s => {
    const g = c.createLinearGradient(cx + s * 300, 500, cx + s * 380, 500);
    g.addColorStop(0, SKIN); g.addColorStop(1, SKIN_D);
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(cx + s * 190, 470);
    c.lineTo(cx + s * 300, 520);
    c.lineTo(cx + s * 352, 900);
    c.lineTo(cx + s * 340, 1150);
    c.lineTo(cx + s * 282, 1155);
    c.lineTo(cx + s * 268, 900);
    c.lineTo(cx + s * 205, 620);
    c.closePath(); c.fill();
  });

  // 다리 — 반바지 아래 맨살, 발은 벌어진다
  [-1, 1].forEach(s => {
    const g = c.createLinearGradient(cx + s * 90, 1400, cx + s * 200, 1400);
    g.addColorStop(0, SKIN); g.addColorStop(1, SKIN_D);
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(cx + s * 55, 1330);
    c.lineTo(cx + s * 190, 1330);
    c.lineTo(cx + s * 168, 1700);
    c.lineTo(cx + s * 215, 1870);   // 발이 바깥으로 벌어진다
    c.lineTo(cx + s * 95, 1880);
    c.lineTo(cx + s * 78, 1700);
    c.closePath(); c.fill();
  });

  // 반바지 — 상의와 같은 색
  const gp = c.createLinearGradient(cx - 250, 880, cx + 250, 1400);
  gp.addColorStop(0, NAVY); gp.addColorStop(0.5, NAVY); gp.addColorStop(1, NAVY_D);
  c.fillStyle = gp;
  c.beginPath();
  c.moveTo(cx - 218, 872);
  c.lineTo(cx - 245, 1180);
  c.lineTo(cx - 232, 1400);
  c.lineTo(cx - 52, 1398);
  c.lineTo(cx - 34, 1180);
  c.lineTo(cx, 1168);
  c.lineTo(cx + 34, 1180);
  c.lineTo(cx + 52, 1398);
  c.lineTo(cx + 232, 1400);
  c.lineTo(cx + 245, 1180);
  c.lineTo(cx + 218, 872);
  c.closePath(); c.fill();
  // 옆면 흰 프린트 (밝은 이물)
  c.fillStyle = 'rgba(255,255,255,.88)';
  c.fillRect(cx - 200, 900, 26, 420);

  // 상의 — 박시한 반팔, 하의와 같은 색
  const gt = c.createLinearGradient(cx - 230, 460, cx + 230, 900);
  gt.addColorStop(0, NAVY); gt.addColorStop(0.55, NAVY); gt.addColorStop(1, NAVY_D);
  c.fillStyle = gt;
  c.beginPath();
  c.moveTo(cx - 78, 452);
  c.lineTo(cx - 196, 468);
  c.lineTo(cx - 300, 520);      // 어깨끝
  c.lineTo(cx - 290, 700);      // 반팔 소맷부리 바깥
  c.lineTo(cx - 214, 706);      // 소맷부리 안쪽
  c.lineTo(cx - 226, 780);      // 겨드랑이
  c.lineTo(cx - 234, 874);
  c.lineTo(cx + 234, 874);
  c.lineTo(cx + 226, 780);
  c.lineTo(cx + 214, 706);
  c.lineTo(cx + 290, 700);
  c.lineTo(cx + 300, 520);
  c.lineTo(cx + 196, 468);
  c.lineTo(cx + 78, 452);
  c.closePath(); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.10)'; c.lineWidth = 5;
  c.beginPath(); c.ellipse(cx, 455, 80, 26, 0, 0, Math.PI); c.stroke();

  // 배경 제거된 사진의 부드러운 경계를 흉내낸다
  const im = c.getImageData(0, 0, W, H);
  return { canvas: cv, imageData: im };
}
