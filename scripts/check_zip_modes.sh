#!/usr/bin/env bash
# 릴리스 zip의 Unix 엔트리 모드 검사 (#179).
# 사용법: bash scripts/check_zip_modes.sh <zip> <linux-x64|osx-arm64>
# 검사 대상: 변환기 실행 파일과 makerom/bannertool(평면 사본 + rid 디렉터리 사본)이 0755로
# 기록됐는지, 그리고 압축을 풀었을 때 실제로 실행 가능한지. 변환기는 읽기 전용 미디어에서만
# chmod 폴백을 쓰므로, 풀기만 해도 실행되어야 한다.
set -Eeuo pipefail

zip=${1:?zip 경로가 필요합니다}
runtime=${2:?runtime(linux-x64 또는 osx-arm64)이 필요합니다}

if [[ "$runtime" == linux-x64 ]]; then
    prefix=neo3ds-converter-$runtime
else
    prefix=neo3ds-converter-$runtime/neo3ds-converter.app/Contents/MacOS
fi

paths=(
    "$prefix/neo3ds-converter"
    "$prefix/tools/makerom"
    "$prefix/tools/bannertool"
    "$prefix/tools/$runtime/makerom"
    "$prefix/tools/$runtime/bannertool"
)

fail=0
listing=$(unzip -Z "$zip")
for p in "${paths[@]}"; do
    esc=${p//./\\.} # .app 경로의 점은 정규식에서 이스케이프
    if ! grep -qE "^-rwxr-xr-x[[:space:]].*[[:space:]]$esc$" <<<"$listing"; then
        printf '::error::%s is not 0755 in %s\n' "$p" "$(basename "$zip")"
        fail=1
    fi
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
unzip -q "$zip" -d "$tmp"
for p in "${paths[@]}"; do
    if [[ ! -x "$tmp/$p" ]]; then
        printf '::error::%s is not executable after extraction\n' "$p"
        fail=1
    fi
done

if [[ $fail -eq 0 ]]; then
    printf 'OK %s: %d entries 0755 and executable\n' "$(basename "$zip")" "${#paths[@]}"
fi
exit "$fail"
