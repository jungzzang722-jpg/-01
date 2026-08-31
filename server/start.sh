#!/usr/bin/env bash
#
# start.sh — 서버 두 개를 한 번에 띄운다.
#
# 전시 당일에 환경변수 이름을 외우고 있어야 하는 프로그램은,
# 전시 당일에 안 돌아가는 프로그램이다. 그래서 전부 여기 적어 둔다.
#
#   ./server/start.sh          모의 모드 (모델 없이 배선만)
#   ./server/start.sh real     실제 합성 (CatVTON 설치돼 있어야 함)
#
# 끄실 때는 Ctrl+C 한 번이면 둘 다 같이 꺼집니다.

set -u
cd "$(dirname "$0")/.."          # 어디서 실행하든 프로젝트 폴더에서 돈다

MODE="${1:-mock}"
MODEL_PORT="${MODEL_PORT:-8788}"
RELAY_PORT="${RELAY_PORT:-8787}"

PY="$(command -v python3 || true)"
NODE="$(command -v node || true)"
if [ -z "$PY" ];   then echo "✗ python3 이 없습니다. https://www.python.org 에서 설치해 주세요."; exit 1; fi
if [ -z "$NODE" ]; then echo "✗ node 가 없습니다.  https://nodejs.org 에서 설치해 주세요.";      exit 1; fi

# 이미 떠 있는 서버가 있으면 먼저 정리한다 — 포트가 물려 있으면
# 새로 띄운 서버가 조용히 실패하고, 화면에는 아무 단서도 남지 않는다.
for P in "$MODEL_PORT" "$RELAY_PORT"; do
  PID="$(lsof -ti tcp:"$P" 2>/dev/null || true)"
  if [ -n "$PID" ]; then echo "· 포트 $P 를 쓰던 것을 끕니다 (pid $PID)"; kill "$PID" 2>/dev/null || true; sleep 1; fi
done

PIDS=""
DONE=0
cleanup() { [ "$DONE" = 1 ] && return; DONE=1; echo; echo "· 서버를 끕니다"; for p in $PIDS; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

echo "· 모델 서버 (mode=$MODE, 포트 $MODEL_PORT)"
VTON_MODE="$MODE" PORT="$MODEL_PORT" "$PY" server/model/vton_server.py &
PIDS="$PIDS $!"

echo "· 중계 서버 (포트 $RELAY_PORT)"
VTON_PROVIDER=custom \
VTON_ENDPOINT="http://127.0.0.1:$MODEL_PORT/tryon" \
PORT="$RELAY_PORT" \
"$NODE" server/vton-proxy.mjs &
PIDS="$PIDS $!"

# 뜰 때까지 **기다렸다가** 점검한다.
#
# 예전엔 sleep 3 이었는데, real 모드에서 모델을 올리는 데는 몇 분이 걸린다.
# 그 사이에 점검이 돌아 버리면 "모델 서버에 연결할 수 없습니다"가 먼저 찍히고,
# 몇 분 뒤 "모델 준비 완료"가 맨 아래에 찍힌다 — 순서가 뒤집혀서, 다 잘 된
# 화면이 실패한 화면처럼 보인다. 실제로 그렇게 보였다.
if [ "$MODE" = "real" ]; then
  echo "· 모델을 올리는 중입니다. 처음 한 번은 가중치를 내려받느라 5~15분 걸립니다."
  echo "  (끄지 마세요. 진행 표시가 없어도 돌고 있습니다.)"
  WAIT=1200            # 20분
else
  WAIT=20
fi
i=0
until curl -sf -m 2 "http://127.0.0.1:$MODEL_PORT/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge "$WAIT" ]; then echo "✗ 모델 서버가 뜨지 않았습니다. 위쪽 에러를 봐 주세요."; break; fi
  # 살아 있는지 확인 — 죽었으면 더 기다릴 이유가 없다
  if ! kill -0 $(echo $PIDS | awk '{print $1}') 2>/dev/null; then
    echo "✗ 모델 서버가 죽었습니다. 위쪽 에러를 봐 주세요."; break
  fi
  sleep 1
done
echo
"$NODE" server/doctor.mjs || true

echo
echo "──────────────────────────────────────────────"
echo "  브라우저에서 열 파일:  퍼스널컬러진단_고화질합성.html"
echo "  고화질 합성 서버 주소:  http://localhost:$RELAY_PORT"
echo "  끄실 때: 이 창에서 Ctrl+C"
echo "──────────────────────────────────────────────"

wait
