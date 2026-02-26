#!/usr/bin/env bash
set -euo pipefail

# Uso:
#   ./scripts/release_no_pr.sh export [BASE_REF]
#   ./scripts/release_no_pr.sh apply <PATCH_FILE>
#
# Ejemplos:
#   ./scripts/release_no_pr.sh export HEAD~1
#   ./scripts/release_no_pr.sh apply /tmp/nexo-1.1.12-fix.patch

MODE="${1:-}";

if [[ "$MODE" == "export" ]]; then
  BASE_REF="${2:-HEAD~1}"
  OUT="/tmp/nexo-1.1.12-fix.patch"

  echo "[1/4] Validando versión..."
  VERSION=$(node -p "require('./nexo-desktop/package.json').version")
  if [[ "$VERSION" != "1.1.12-fix" ]]; then
    echo "ERROR: versión actual es '$VERSION' y debe ser '1.1.12-fix'" >&2
    exit 1
  fi

  echo "[2/4] Generando patch desde $BASE_REF..HEAD"
  git diff "$BASE_REF"..HEAD > "$OUT"

  echo "[3/4] Tamaño patch: $(wc -c < "$OUT") bytes"
  echo "[4/4] Patch generado: $OUT"
  echo
  echo "Para aplicarlo en otra copia del repo:"
  echo "  git apply --index $OUT"
  echo "  git commit -m 'Apply Nexo 1.1.12-fix updates'"
  exit 0
fi

if [[ "$MODE" == "apply" ]]; then
  PATCH_FILE="${2:-}"
  if [[ -z "$PATCH_FILE" ]]; then
    echo "ERROR: falta ruta de patch" >&2
    echo "Uso: ./scripts/release_no_pr.sh apply /ruta/al.patch" >&2
    exit 1
  fi

  echo "[1/3] Validando patch: $PATCH_FILE"
  git apply --check "$PATCH_FILE"

  echo "[2/3] Aplicando patch con index"
  git apply --index "$PATCH_FILE"

  echo "[3/3] Listo. Ahora commit manual:"
  echo "  git commit -m 'Apply Nexo 1.1.12-fix updates'"
  exit 0
fi

echo "Uso:"
echo "  ./scripts/release_no_pr.sh export [BASE_REF]"
echo "  ./scripts/release_no_pr.sh apply <PATCH_FILE>"
exit 1
