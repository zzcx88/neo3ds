# 빌드 · 테스트 · 릴리스

모든 빌드와 테스트는 **Windows 10/11 64비트**에서 실행한다. 스크립트에 Windows 경로(`C:\devkitPro`, Azahar)가 하드코딩되어 있다.

산출물 바이너리는 git에 커밋하지 않는다. `.gitignore` 대상: `engine/*.elf`, `converter/**/bin/`, `converter/**/obj/`, `dist/`, `out/`, `tools/`, `roms/`.

## 1. 엔진 빌드

필요: devkitPro (devkitARM, libctru), `C:\devkitPro` 설치.

```sh
bash scripts/build_engine.sh
```

- 산출물: `engine/engine.elf`
- 추가 make 인자 전달 가능 (`bash scripts/build_engine.sh clean`)
- msys2 bash를 직접 호출한다 (Git Bash에는 make가 없음)

## 2. 변환기 빌드

필요: .NET 10 SDK.

선행 준비:

1. 엔진 빌드 (§1) — csproj가 `engine/engine.elf`를 출력 폴더의 `tools\`에 복사한다
2. 외부 도구 배치 (릴리스에서 받아 둘 것, git 제외):
   - `tools/makerom/makerom.exe` ([makerom](https://github.com/3DSGuy/Project_CTR))
   - `tools/bannertool/windows-x86_64/bannertool.exe` ([bannertool](https://github.com/diasurgical/bannertool))

```sh
dotnet build -c Release converter/Neo3dsConverter
```

- 산출물: `converter/Neo3dsConverter/bin/Release/net10.0-windows/` — exe + `tools\` (`engine.elf`, `neo3ds.rsf`, `makerom.exe`, `bannertool.exe`)
- exe와 `tools\` 폴더는 항상 같이 둔다
- 버전: `converter/Neo3dsConverter/Neo3dsConverter.csproj`의 `<Version>` 한 곳에서 관리

## 3. CIA 만들기 (수동 확인)

```sh
Neo3dsConverter.exe <게임.zip> [게임2.zip ...] [저장 폴더] [--title "이름"] [--icon 그림.png] [--banner 그림.png] [--set 롬셋] [--system aes|mvs] [--region eu|jp|us] [--pack] [--lang ko|en]
Neo3dsConverter.exe --launcher [저장 폴더]
```

- 게임 롬 zip과 `neogeo.zip`을 같은 폴더에, zip 이름은 MAME 이름 유지
- Title ID는 zip 파일명에서 고정 생성 → 같은 zip으로 다시 만들면 기존 설치 위에 덮어쓴다
- `NEO3DS_CXI=1` 환경변수: CIA 대신 Azahar용 CXI 생성
- `NEO3DS_DEBUG=1`: 실패 시 스택 트레이스 출력

## 4. Azahar 테스트 (개발 루프)

필요 (git 제외, 로컬 준비): `tools/azahar/azahar-windows-msvc-2126.2/azahar.exe`, `roms/*.zip`.

```sh
scripts/azahar_test.sh [rom.zip]   # 기본 roms/kof98.zip
```

1. 엔진 재빌드 → `dist/converter/tools/engine.elf`에 복사
2. `NEO3DS_CXI=1`로 CXI 빌드 → `out/`
3. Azahar 종료 후 CXI로 재실행

사전 준비: 변환기 빌드 산출물(exe + `tools\`)을 `dist/converter/`에 복사해 둔다. 스크립트는 그 경로의 exe를 사용한다.

회귀 확인:

```sh
scripts/azahar_bench.sh
```

어트랙트 데모와 대전 진입 스크린샷을 `$TEMP/claude/s/`에 저장한다 (`demo.png`, `fight.png`).

## 5. 실기 테스트

1. 만든 `.cia`를 SD 카드에 복사
2. 3DS에서 FBI → SD → 파일 선택 → Install CIA
3. HOME 메뉴에서 실행, FPS·사운드·조작 확인
4. 아래 화면 Diagnostics에서 코어 시간·메모리 확인 가능

## 6. 게임 DB 갱신

MAME `src/mame/snk/neogeo.cpp`를 받아서:

```sh
py scripts/gen_gamedb.py neogeo.cpp converter/assets/neogeo_games.json
```

## 7. 릴리스

1. `converter/Neo3dsConverter/Neo3dsConverter.csproj`의 `<Version>` 올리기
2. 테스트 플래그 없이 엔진 빌드 (§1, `make clean` 후) + 외부 도구 배치 (§2 선행 준비: `tools\makerom`, `tools\bannertool`)
3. `powershell -File scripts/package_release.ps1 -WithLauncher` — self-contained 단일 exe로 publish 후 `dist\neo3ds-converter.zip` 생성
   (zip 안은 `neo3ds-converter\` 단일 폴더: exe + `tools\` + `README.txt`(한·영, 버전 자동 기입) + `LICENSE.txt` + `THIRD_PARTY_NOTICES.md`
   + `neo3ds-launcher.cia`. 런처 CIA는 `dist\neo3ds-launcher.cia`에도 따로 나온다. 파일명은 고정 — README·소개 페이지의 latest/download 링크가 깨지지 않게)
4. 커밋 후 태그 푸시 (`v1.1.0` 형식)
5. GitHub Releases에 zip과 `neo3ds-launcher.cia` 첨부 + 변경점 기록
