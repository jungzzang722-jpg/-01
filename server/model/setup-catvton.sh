#!/usr/bin/env bash
# CatVTON 설치 도우미
#
# 하는 일은 저장소를 받아 두고 무엇을 해야 하는지 알려주는 것까지다.
# 실제 conda 환경 구성은 저장소의 INSTALL.md 를 따라야 한다 — 여기에 옮겨
# 적으면 조용히 낡는다.
#
#   bash server/model/setup-catvton.sh [설치할 위치]
#
# 라이선스: CatVTON 은 CC BY-NC-SA 4.0 (비상업 전용) 이다.
#   졸업전시·수업·연구는 가능하고, 유료 서비스는 저자와 별도 계약이 필요하다.
#   전시 패널에 모델 이름과 저자를 표시해야 한다(BY 조건).
set -euo pipefail

DEST="${1:-$HOME/CatVTON}"

echo "── CatVTON 설치 ──────────────────────────────────────────────"
echo "위치: $DEST"
echo

if [ -d "$DEST/.git" ]; then
  echo "이미 있습니다. 최신으로 갱신합니다."
  git -C "$DEST" pull --ff-only || echo "  (갱신 실패 — 그대로 진행합니다)"
else
  git clone --depth 1 https://github.com/Zheng-Chong/CatVTON "$DEST"
fi

echo
echo "── 다음에 할 일 ──────────────────────────────────────────────"
echo
echo "1) 저장소의 설치 안내를 따라 환경을 만드세요."
echo "     $DEST/INSTALL.md"
echo "   AutoMasker(옷 놓일 자리 마스크)에는 Detectron2 와 DensePose 가 필요합니다."
echo "   설치 용량의 대부분이 이 전처리입니다."
echo
echo "2) 가중치는 처음 실행할 때 자동으로 내려받습니다 (huggingface_hub)."
echo "     zhengchong/CatVTON  ·  runwayml/stable-diffusion-inpainting"
echo "   수 GB 이므로 전시장 와이파이가 아니라 **미리** 받아 두세요."
echo
echo "3) 모델 서버를 켭니다. 저장소 위치를 알려줘야 합니다 —"
echo "   CatVTON 의 model.* / utils 임포트가 저장소 기준 경로이기 때문입니다."
echo
echo "     VTON_MODE=real VTON_REPO_DIR=$DEST \\"
echo "     python3 server/model/vton_server.py"
echo
echo "4) 잘 떴는지 확인:"
echo "     curl -s http://localhost:8788/health"
echo "   loaded=true 가 나와야 합니다. false 면 error 항목에 이유가 있습니다."
echo
echo "GPU 가 아직 없다면 배선부터 확인하세요 (모델 없이 됩니다):"
echo "     VTON_MODE=mock python3 server/model/vton_server.py"
echo "     node build/test-selfhost.mjs"
