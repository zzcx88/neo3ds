#!/usr/bin/env bash
# README / 사용법: bash scripts/build_unix_tools.sh [--skip-existing]
# Linux x86_64 또는 macOS arm64 호스트에서 makerom/bannertool을 소스 빌드한다.
# 전제조건: 인터넷(HTTPS GitHub), Bash 3.2+, git, GNU make, C11/C++11
# 컴파일러(cc/c++ 또는 CC/CXX에 지정한 실행 파일), ar, zip, 기본 Unix 도구.
# Linux 예: sudo apt-get install build-essential git zip libyaml-dev
# macOS 예: xcode-select --install (필요시 brew install libyaml)
# makerom은 libyaml/mbedtls/blz 소스를 포함한다. yaml.h 또는 -lyaml 오류는
# 의존성 빌드 로그부터 확인하고, 필요하면 libyaml 개발 패키지를 설치한다.
# 소스/로그: out/unix-tools.XXXXXX (실패 진단용으로 유지, git 제외).
# 산출물: tools/linux-x64/{makerom,bannertool} 또는 tools/osx-arm64/...
# --skip-existing: 비어 있지 않은 기존 실행 파일만 건너뛴다. 기본은 재빌드.
# CC/CXX에는 인자 없는 실행 파일 경로를 지정한다. 크로스 컴파일은 지원하지 않는다.
# 소스: https://github.com/3DSGuy/Project_CTR (태그 makerom-v0.19.0 고정, #22)
#       https://github.com/diasurgical/bannertool (태그 1.2.0 고정, buildtools 서브모듈 포함)
set -Eeuo pipefail

fail() {
    printf '오류: %s\n' "$*" >&2
    exit 1
}

trap 'printf "오류: %s행 명령 실패 (종료 코드 %s).\n" "$LINENO" "$?" >&2; exit 1' ERR

skip_existing=0
for arg in "$@"; do
    case "$arg" in
        --skip-existing) skip_existing=1 ;;
        -h|--help)
            printf '사용법: bash scripts/build_unix_tools.sh [--skip-existing]\n'
            exit 0
            ;;
        *) fail "알 수 없는 옵션: $arg (--help 참조)" ;;
    esac
done

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
os=$(uname -s)
arch=$(uname -m)
case "$os/$arch" in
    Linux/x86_64) rid=linux-x64; banner_platform=linux-x86_64 ;;
    Darwin/arm64) rid=osx-arm64; banner_platform=mac-arm64 ;;
    *) fail "지원하지 않는 호스트: $os/$arch (Linux x86_64, macOS arm64 전용). Rosetta에서는 arm64 터미널을 사용하세요." ;;
esac
destination="$root/tools/$rid"

should_skip() {
    [[ "$skip_existing" == 1 && -s "$destination/$1" && -x "$destination/$1" ]]
}

if should_skip makerom && should_skip bannertool; then
    printf '스킵: %s의 makerom, bannertool 실행 파일이 이미 존재합니다.\n' "$destination"
    exit 0
fi

cc=${CC:-cc}
cxx=${CXX:-c++}
for tool in git make "$cc" "$cxx" ar zip mktemp tee cp chmod; do
    command -v "$tool" >/dev/null 2>&1 ||
        fail "필수 도구 없음: $tool. Linux: build-essential/git/zip, macOS: Xcode Command Line Tools를 설치하세요."
done
mkdir -p "$root/out" "$destination"
work=$(mktemp -d "$root/out/unix-tools.XXXXXX")
printf '호스트: %s/%s, 작업 디렉터리: %s\n' "$os" "$arch" "$work"

# 재현 가능한 빌드: upstream 태그 고정 (#22). 태그 변경 시 SHA 주석도 함께 갱신.
makerom_ref=makerom-v0.19.0 # e8f5f529c54ff9b22a2491a480ffa69206bf7b19 (2026-10-20 실측)
bannertool_ref=1.2.0 # 16d8c5a0ce02a5e06e64ab42275132fca57c04a2 (2026-10-20 실측)

clone_source() {
    local name=$1 url=$2 ref=$3
    # 전체 태그 이력 유지: bannertool이 git describe --tags로 버전을 읽는다 (shallow clone 금지).
    if ! git clone --recurse-submodules "$url" "$work/$name"; then
        fail "$name 소스/서브모듈 다운로드 실패. 위 git 오류와 네트워크·DNS·프록시·GitHub 접근을 확인하세요. 소스: $work/$name"
    fi
    # 고정 태그로 checkout + 서브모듈을 해당 커밋 기준으로 맞춤 (clone 직후는 HEAD 기준이므로 필수).
    if ! git -C "$work/$name" checkout --quiet "$ref" ||
        ! git -C "$work/$name" submodule update --init --recursive --quiet; then
        fail "$name 태그 checkout 실패: $ref. 태그 존재 여부와 네트워크를 확인하세요. 소스: $work/$name"
    fi
}

install_binary() {
    local source=$1 name=$2
    [[ -s "$source" ]] || fail "$name 빌드 산출물 없음: $source"
    cp -- "$source" "$destination/$name"
    chmod +x "$destination/$name"
    printf '배치 완료: %s\n' "$destination/$name"
}

if should_skip makerom; then
    printf '스킵: %s/makerom\n' "$destination"
else
    clone_source Project_CTR https://github.com/3DSGuy/Project_CTR.git "$makerom_ref"
    # upstream 요구 순서: 의존성 먼저, 본체 나중. 병렬 의존성 경합 방지.
    if ! (
        cd "$work/Project_CTR/makerom"
        make -j1 deps "CC=$cc" "CXX=$cxx" &&
            make -j1 "CC=$cc" "CXX=$cxx"
    ) 2>&1 | tee "$work/makerom.log"; then
        fail "makerom 빌드 실패. C11/C++11 컴파일러·ar·libyaml 의존성을 확인하세요 (Linux: libyaml-dev, macOS: brew install libyaml). 로그: $work/makerom.log"
    fi
    install_binary "$work/Project_CTR/makerom/bin/makerom" makerom
fi

if should_skip bannertool; then
    printf '스킵: %s/bannertool\n' "$destination"
else
    clone_source bannertool https://github.com/diasurgical/bannertool.git "$bannertool_ref"
    banner_args=(TARGET=NATIVE "CC=$cc" "CXX=$cxx")
    if [[ "$os" == Darwin ]]; then
        # Legacy buildtools rejects arm64 in its uname whitelist. Override only
        # detection input; HOST_ARCH stays arm64, so no x86 -m64 flag is added.
        # Native Apple compiler still emits arm64; this is not an x86 build.
        banner_args+=(UNAME_M=x86_64 HOST_ARCH=arm64)
    fi
    if ! make -C "$work/bannertool" -j1 "${banner_args[@]}" 2>&1 |
        tee "$work/bannertool.log"; then
        if [[ "$os" == Darwin ]]; then
            printf '%s\n' \
                'macOS bannertool 네이티브 빌드 실패. Docker 대안 (Linux 바이너리 생성):' \
                "  cd \"$work/bannertool\"" \
                '  docker build --platform linux/amd64 -t bannertool-builder .' \
                '  docker run --platform linux/amd64 --name bannertool-builder bannertool-builder' \
                '  docker cp bannertool-builder:/bannertool/output/bannertool.zip .' \
                'Docker 산출물은 Linux 전용입니다. macOS tools/osx-arm64/에 복사하지 마세요.' >&2
        fi
        fail "bannertool 빌드 실패. 컴파일러·zip·buildtools 서브모듈과 위 오류를 확인하세요. 로그: $work/bannertool.log"
    fi
    install_binary "$work/bannertool/output/$banner_platform/bannertool" bannertool
fi

printf '완료: %s (소스/로그 유지: %s)\n' "$destination" "$work"
