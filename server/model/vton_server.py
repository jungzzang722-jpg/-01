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
import socket
import sys
import time
import http.server
import socketserver

MODE = os.environ.get('VTON_MODE', 'mock').lower()
PORT = int(os.environ.get('PORT', '8788'))
MODEL_NAME = os.environ.get('VTON_MODEL_NAME', 'catvton')
STEPS = int(os.environ.get('VTON_STEPS', '30'))
MAX_BODY = 24 * 1024 * 1024

_model = None
# 모델이 왜 안 올라왔는지. 서버는 뜨되 이유를 계속 말할 수 있어야 한다 —
# 전시장에서 서버가 아예 안 뜨면 확인할 방법이 없다.
_load_error = None


# ─────────────────────────────────────────────────────────────────────────
# 모델 — 여기 두 함수만 채우면 된다
# ─────────────────────────────────────────────────────────────────────────
def load_model():
    """
    모델을 한 번만 올린다. 요청마다 올리면 매번 수십 초가 걸린다.

    CatVTON 기준 (저장소 README·app.py 확인):
        1024×768 추론에 VRAM 약 8GB, 전체 파라미터 899M
        → RTX 3060 12GB 같은 소비자용 GPU 에서 돈다. 전시용으로 이게 크다.

    가중치는 huggingface_hub 가 처음 한 번 자동으로 내려받는다.
    """
    global _model, _load_error
    if _model is not None:
        return _model

    # CatVTON 의 `model.*` 과 `utils` 는 **저장소 기준 경로**다. 이 파일을
    # 저장소 밖에서 실행하면 그대로 ModuleNotFoundError 가 난다.
    # VTON_REPO_DIR 로 저장소 위치를 받아 경로에 넣는다.
    repo_dir = os.environ.get('VTON_REPO_DIR', '')
    if repo_dir and repo_dir not in sys.path:
        sys.path.insert(0, repo_dir)

    import torch
    from diffusers.image_processor import VaeImageProcessor
    from huggingface_hub import snapshot_download
    from model.pipeline import CatVTONPipeline
    from utils import init_weight_dtype

    repo_path = snapshot_download(repo_id=os.environ.get('VTON_REPO', 'zhengchong/CatVTON'))
    device = os.environ.get('VTON_DEVICE', 'cuda')

    pipeline = CatVTONPipeline(
        base_ckpt=os.environ.get('VTON_BASE', 'runwayml/stable-diffusion-inpainting'),
        attn_ckpt=repo_path,
        attn_ckpt_version='mix',
        weight_dtype=init_weight_dtype(os.environ.get('VTON_PRECISION', 'bf16')),
        use_tf32=True,
        device=device,
    )
    # 옷이 놓일 자리 마스크. 브라우저가 만들어 보내 주면 여기서는 필요 없다 —
    # 사람 파싱(SCHP)과 자세 추정(DensePose)이 설치의 대부분이고, 애플
    # 실리콘에서는 GPU 가속조차 안 되는 부분이다. 그래서 **선택**으로 둔다.
    automasker = None
    if os.environ.get('VTON_AUTOMASK', '0') == '1':
        from model.cloth_masker import AutoMasker
        automasker = AutoMasker(
            densepose_ckpt=os.path.join(repo_path, 'DensePose'),
            schp_ckpt=os.path.join(repo_path, 'SCHP'),
            device=device,
        )
    mask_processor = VaeImageProcessor(
        vae_scale_factor=8, do_normalize=False,
        do_binarize=True, do_convert_grayscale=True,
    )

    _model = {
        'pipeline': pipeline, 'automasker': automasker,
        'mask_processor': mask_processor, 'device': device, 'torch': torch,
    }
    _load_error = None
    return _model


def _flatten_on_white(png_bytes):
    """
    투명 배경을 흰색으로 채운다.

    우리가 보내는 인물 이미지는 **이미 배경이 지워져 있다.** 그런데 모델은
    배경이 있는 사진으로 학습돼 있어서, 투명 채널을 그대로 넣으면 알파가
    검정으로 해석되어 결과가 무너진다. 상품컷과 같은 흰 배경으로 만들어 준다.
    """
    from PIL import Image
    im = Image.open(io.BytesIO(png_bytes))
    if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
        im = im.convert('RGBA')
        bg = Image.new('RGB', im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert('RGB')


def run_model(person_png: bytes, garment_png: bytes, category: str,
              mask_png: bytes = None) -> bytes:
    """
    인물 PNG + 옷 PNG → 합성 PNG.

    app.py 의 submit_function 과 같은 순서다.
      1) 인물은 잘라 맞추고(resize_and_crop), 옷은 여백을 채워 맞춘다
         (resize_and_padding). 둘을 반대로 하면 옷이 잘려 나간다.
      2) 마스크를 만들고 가장자리를 흐린다(blur_factor=9). 흐리지 않으면
         옷과 피부의 경계에 딱딱한 선이 남는다.
      3) 파이프라인을 돌린다.

    결과는 학습 해상도(기본 768×1024)로 나온다. 원래 비율로 되돌리는 것은
    합성 결과를 다시 늘리는 일이라 화질이 떨어지므로, 브라우저에서 배치할 때
    맞추는 편이 낫다 — 여기서는 그대로 돌려준다.
    """
    from PIL import Image

    m = load_model()          # 저장소 경로를 sys.path 에 넣는 일도 여기서 한다
    from utils import resize_and_crop, resize_and_padding
    torch = m['torch']
    W = int(os.environ.get('VTON_WIDTH', '768'))
    H = int(os.environ.get('VTON_HEIGHT', '1024'))

    person = _flatten_on_white(person_png)
    cloth = _flatten_on_white(garment_png) if garment_png else None
    if cloth is None:
        raise ValueError('옷 이미지가 없습니다.')

    person = resize_and_crop(person, (W, H))
    cloth = resize_and_padding(cloth, (W, H))

    if mask_png:
        # 브라우저가 보낸 마스크. 인물과 **같은 방식으로** 맞춰야 자리가 어긋나지
        # 않는다 — 인물은 crop 했으므로 마스크도 crop 이다.
        mask = _flatten_on_white(mask_png).convert('L')
        mask = resize_and_crop(mask.convert('RGB'), (W, H)).convert('L')
    elif m['automasker'] is not None:
        cloth_type = 'lower' if category == 'bottom' else 'upper'
        mask = m['automasker'](person, cloth_type)['mask']
    else:
        raise ValueError(
            '마스크가 없습니다. 브라우저가 마스크를 함께 보내거나, '
            'VTON_AUTOMASK=1 로 자동 생성을 켜 주세요(Detectron2·DensePose 필요).')
    mask = m['mask_processor'].blur(mask, blur_factor=9)

    seed = int(os.environ.get('VTON_SEED', '555'))
    generator = torch.Generator(device=m['device']).manual_seed(seed) if seed >= 0 else None

    result = m['pipeline'](
        image=person,
        condition_image=cloth,
        mask=mask,
        num_inference_steps=STEPS,
        guidance_scale=float(os.environ.get('VTON_GUIDANCE', '2.5')),
        generator=generator,
    )[0]

    buf = io.BytesIO()
    result.save(buf, format='PNG')
    return buf.getvalue()


# ─────────────────────────────────────────────────────────────────────────
# 모의 모드 — GPU 없이 배선을 검증한다
# ─────────────────────────────────────────────────────────────────────────
def run_mock(person_png: bytes, garment_png: bytes, category: str,
             mask_png: bytes = None) -> bytes:
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
            if MODE == 'mock':
                ko = '모의 모드 — 실제 합성은 하지 않습니다'
            elif _model is not None:
                ko = '준비됨'
            else:
                ko = '모델이 올라오지 않았습니다: %s' % (_load_error or '알 수 없음')
            return self._json(200, {
                'ok': True, 'mode': MODE, 'model': MODEL_NAME,
                'loaded': _model is not None, 'error': _load_error,
                'automask': os.environ.get('VTON_AUTOMASK', '0') == '1',
                'ko': ko
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
        mask = parts.get('mask')
        category = (parts.get('category') or b'top').decode('utf-8', 'replace')

        if not person:
            return self._json(400, {'ok': False, 'ko': '인물 이미지가 없습니다.'})

        t0 = time.time()
        try:
            out = run_mock(person, garment, category, mask) if MODE == 'mock' \
                else run_model(person, garment, category, mask)
        except NotImplementedError as e:
            return self._json(501, {'ok': False, 'ko': str(e)})
        except ImportError as e:
            # 전시장에서 가장 흔한 사고다. 무엇이 없는지 정확히 말해 준다.
            return self._json(503, {'ok': False, 'ko':
                '필요한 패키지가 설치되지 않았습니다: %s — '
                'CatVTON 저장소의 INSTALL.md 를 따라 설치해 주세요.' % e})
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
    # 맥에서 localhost 는 IPv6(::1) 로 먼저 풀린다. IPv4 에만 붙어 있으면
    # 브라우저가 연결할 곳이 없고, 서버에는 아무 기록도 남지 않는다.
    address_family = socket.AF_INET6

    def server_bind(self):
        # IPv6 소켓 하나로 IPv4 도 함께 받는다(듀얼스택)
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except OSError:
            pass
        super().server_bind()


if __name__ == '__main__':
    if MODE == 'real':
        print('모델을 올리는 중… (처음 한 번만, 수십 초 걸릴 수 있습니다)')
        try:
            load_model()
            print('모델 준비 완료')
        except Exception as e:
            # 여기서 죽으면 안 된다. 서버가 아예 안 뜨면 무엇이 잘못됐는지
            # 확인할 창구조차 없어진다 — 전시 당일에 가장 곤란한 상황이다.
            _load_error = '%s: %s' % (type(e).__name__, e)
            print('⚠ 모델을 올리지 못했습니다: %s' % _load_error)
            print('  서버는 그대로 띄웁니다. /health 로 상태를 볼 수 있고,')
            print('  합성 요청에는 이유를 담아 응답합니다. 앱은 내장 엔진으로 되돌아갑니다.')
    # IPv6 듀얼스택을 먼저 시도하고, 없는 환경이면 IPv4 로 물러난다.
    # 맥에서 localhost 는 ::1 로 먼저 풀리므로 IPv4 만으로는 연결이 안 된다.
    httpd = None
    for family, host in ((socket.AF_INET6, '::'), (socket.AF_INET, '0.0.0.0')):
        try:
            Server.address_family = family
            httpd = Server((host, PORT), Handler)
            break
        except OSError as e:
            if family is socket.AF_INET6:
                print('  IPv6 를 쓸 수 없어 IPv4 로 붙습니다.')
                continue
            print('⚠ 포트 %d 에 붙지 못했습니다: %s' % (PORT, e))
            print('  이전에 켠 서버가 남아 있는지 확인해 주세요.')
            raise SystemExit(1)
    with httpd:
        print('vton-model  http://localhost:%d  mode=%s  model=%s  bind=%s'
              % (PORT, MODE, MODEL_NAME, host))
        print('  라이선스: 공개 VTON 모델은 대부분 CC BY-NC-SA(비상업 전용)입니다.')
        httpd.serve_forever()
