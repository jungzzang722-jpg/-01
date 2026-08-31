#!/usr/bin/env python3
"""
vton_server.py — 가상 피팅 모델 추론 서버 (직접 구동)

중계 서버(vton-proxy.mjs)의 `custom` 어댑터가 부르는 쪽이다. 계약은 하나뿐:

    POST /tryon   multipart/form-data
        person   : PNG (배경이 제거된 인물)
        garment  : PNG (옷)
        category : "top" | "bottom"
    →  200 image/png

이 계약만 지키면 안에서 무슨 모델을 쓰든 상관없다. 모델은 6개월이면
더 나은 것이 나오므로, 갈아 끼울 수 있는 경계를 만드는 것이 핵심이다.

──────────────────────────────────────────────────────────────────────────
모드
  MOCK  (기본)  GPU 없이 배선만 검증한다. 모델을 붙이기 **전에** 클라이언트 →
                중계 → 모델 서버가 끝까지 도는지 확인할 수 있어야 한다.
                그러지 않으면 GPU 문제와 배선 문제를 구분할 수 없다.
  REAL          실제 모델을 돌린다. load_model()/run_model() 두 곳만 채운다.

    VTON_MODE=mock python3 server/model/vton_server.py     # 지금 바로 됨
    VTON_MODE=real python3 server/model/vton_server.py     # GPU 필요

──────────────────────────────────────────────────────────────────────────
라이선스 — 반드시 읽을 것

공개된 주요 가상 피팅 모델(IDM-VTON · CatVTON · OOTDiffusion)은 모두
**CC BY-NC-SA 4.0**, 즉 **비상업 전용**이다.

  · 졸업전시·수업·연구  → 사용 가능
  · 유료 서비스·광고 수익·회사 제품 → **불가**. 저자와 별도 계약이 필요하다.

그리고 BY-NC-SA 는 비상업이기만 하면 되는 것이 아니다.
  BY  저작자 표시 — 전시 패널·크레딧에 모델 이름과 저자를 적어야 한다
  SA  동일조건변경허락 — 파생물을 배포한다면 같은 라이선스여야 한다

전시에서 관람객에게 결과 이미지를 나눠 준다면 BY 표시를 함께 두는 것이 안전하다.
"""

import io
import os
import json
import re
import time
import http.server
import socketserver

MODE = os.environ.get('VTON_MODE', 'mock').lower()
PORT = int(os.environ.get('PORT', '8788'))
MODEL_NAME = os.environ.get('VTON_MODEL_NAME', 'catvton')
STEPS = int(os.environ.get('VTON_STEPS', '30'))
MAX_BODY = 24 * 1024 * 1024

_model = None


# ─────────────────────────────────────────────────────────────────────────
# 모델 — 여기 두 함수만 채우면 된다
# ─────────────────────────────────────────────────────────────────────────
def load_model():
    """
    모델을 한 번만 올린다. 요청마다 올리면 매번 수십 초가 걸린다.

    CatVTON 기준 참고값 (README 기재):
        1024×768 추론에 VRAM 8GB 미만, 전체 파라미터 899M
        → 소비자용 GPU(RTX 3060 12GB 등)에서도 돌아간다. 전시용으로 이게 크다.

    Leffa(다른 후보)는 try-on 에 VRAM 12GB · RAM 32GB · 설치 20GB 를 요구한다.

    실제 적재 코드는 모델 저장소의 현재 README 를 따라야 한다. 여기 적어 두면
    조용히 낡는다 — 그래서 형태만 남기고 비워 둔다.
    """
    global _model
    if _model is not None:
        return _model

    # 예시 골격 (실제 클래스명·인자는 해당 저장소 문서를 따를 것)
    #
    #   import torch
    #   from model.pipeline import CatVTONPipeline        # 저장소에서 제공
    #   _model = CatVTONPipeline(
    #       base_ckpt="stabilityai/stable-diffusion-inpainting",
    #       attn_ckpt="zhengchong/CatVTON",
    #       device="cuda",
    #       weight_dtype=torch.float16,
    #   )
    #
    raise NotImplementedError(
        "load_model() 을 채워 주세요. VTON_MODE=mock 으로 배선을 먼저 확인하실 수 있습니다."
    )


def run_model(person_png: bytes, garment_png: bytes, category: str) -> bytes:
    """
    인물 PNG + 옷 PNG → 합성 PNG.

    주의할 점 셋.

    1) **인물 이미지는 배경이 이미 제거되어 있다.** 대부분의 모델은 배경이 있는
       사진으로 학습돼 있어서 투명 배경을 그대로 넣으면 결과가 나빠진다.
       흰색으로 채워 넣는 편이 안전하다.

    2) **마스크가 필요한 모델이 많다.** 옷이 놓일 자리를 미리 알려줘야 한다.
       보통 사람 파싱(human parsing) + 자세 추정을 함께 돌린다. 그 전처리가
       실제 설치 용량의 대부분을 차지한다.

    3) **해상도.** 대개 1024×768 같은 고정 비율로 학습돼 있다. 넣기 전에
       맞추고, 나온 뒤 원래 비율로 되돌린다.
    """
    model = load_model()
    raise NotImplementedError(
        "run_model() 을 채워 주세요. 저장소의 inference 예제를 그대로 옮기면 됩니다."
    )


# ─────────────────────────────────────────────────────────────────────────
# 모의 모드 — GPU 없이 배선을 검증한다
# ─────────────────────────────────────────────────────────────────────────
def run_mock(person_png: bytes, garment_png: bytes, category: str) -> bytes:
    """
    실제 합성은 하지 않고 인물 이미지를 그대로 돌려준다.

    이게 있어야 GPU 가 없는 상태에서도 클라이언트 → 중계 → 모델 서버가 끝까지
    도는지 확인할 수 있다. 모델을 붙인 뒤 문제가 생기면 "배선은 이미 됐었다"는
    사실이 원인을 절반으로 좁혀 준다.
    """
    time.sleep(float(os.environ.get('VTON_MOCK_DELAY', '0.3')))   # 지연을 흉내 낸다
    return person_png


# ─────────────────────────────────────────────────────────────────────────
# HTTP
# ─────────────────────────────────────────────────────────────────────────
def parse_multipart(buf: bytes, boundary: str) -> dict:
    """
    multipart/form-data 를 직접 읽는다.

    표준 라이브러리의 cgi 모듈을 쓰다가 뺐다 — Python 3.13 에서 제거됐다.
    전시 당일 파이썬을 올렸다가 서버가 안 뜨는 일은 없어야 한다.
    우리가 보내는 형태만 다루면 되므로 완전한 구현일 필요는 없다.
    """
    out = {}
    bb = b'--' + boundary.encode('utf-8')
    i = buf.find(bb)
    while i >= 0:
        start = i + len(bb)
        if buf[start:start + 2] == b'--':          # 마지막 경계
            break
        head_end = buf.find(b'\r\n\r\n', start)
        if head_end < 0:
            break
        head = buf[start:head_end].decode('utf-8', 'replace')
        nxt = buf.find(bb, head_end)
        if nxt < 0:
            nxt = len(buf)
        body = buf[head_end + 4:nxt - 2]           # 앞의 \r\n 제거
        name = re.search(r'name="([^"]*)"', head)
        if name:
            out[name.group(1)] = body
        i = nxt
    return out



class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        # 기본 로그는 요청 URL 을 그대로 남긴다. 사진을 다루는 서버에서는
        # 남기는 것을 최소로 둔다.
        print('  %s %s' % (self.command, self.path))

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?')[0] == '/health':
            return self._json(200, {
                'ok': True, 'mode': MODE, 'model': MODEL_NAME,
                'loaded': _model is not None,
                'ko': '모의 모드 — 실제 합성은 하지 않습니다' if MODE == 'mock' else '준비됨'
            })
        return self._json(404, {'ok': False, 'ko': '없는 경로입니다.'})

    def do_POST(self):
        if self.path.split('?')[0] != '/tryon':
            return self._json(404, {'ok': False, 'ko': '없는 경로입니다.'})

        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {'ok': False, 'ko': '요청 크기가 올바르지 않습니다.'})

        ctype = self.headers.get('Content-Type') or ''
        if 'multipart/form-data' not in ctype:
            return self._json(400, {'ok': False, 'ko': 'multipart 요청이 아닙니다.'})

        m = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', ctype, re.I)
        if not m:
            return self._json(400, {'ok': False, 'ko': 'boundary 를 찾지 못했습니다.'})
        parts = parse_multipart(self.rfile.read(length), (m.group(1) or m.group(2)).strip())

        person = parts.get('person')
        garment = parts.get('garment')
        category = (parts.get('category') or b'top').decode('utf-8', 'replace')

        if not person:
            return self._json(400, {'ok': False, 'ko': '인물 이미지가 없습니다.'})

        t0 = time.time()
        try:
            out = run_mock(person, garment, category) if MODE == 'mock' \
                else run_model(person, garment, category)
        except NotImplementedError as e:
            return self._json(501, {'ok': False, 'ko': str(e)})
        except Exception as e:
            return self._json(500, {'ok': False, 'ko': '합성 실패: %s' % e})

        print('  합성 %s  %.1fs  %dKB' % (category, time.time() - t0, len(out) // 1024))
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    if MODE == 'real':
        print('모델을 올리는 중… (처음 한 번만, 수십 초 걸릴 수 있습니다)')
        try:
            load_model()
            print('모델 준비 완료')
        except NotImplementedError as e:
            print('⚠ %s' % e)
    with Server(('0.0.0.0', PORT), Handler) as httpd:
        print('vton-model  http://localhost:%d  mode=%s  model=%s' % (PORT, MODE, MODEL_NAME))
        print('  라이선스: 공개 VTON 모델은 대부분 CC BY-NC-SA(비상업 전용)입니다.')
        httpd.serve_forever()
