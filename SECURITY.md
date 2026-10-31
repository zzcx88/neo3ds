# 보안 정책

이 저장소에는 서버가 없다. 웹 변환기는 사용자 브라우저에서, 오프라인 변환기는 사용자 PC에서, 엔진은 3DS에서 돈다. 다른 사용자의 데이터나 자격 증명을 다루지 않으므로 **취약점 신고는 공개 이슈로 받는다.**

## 신고

- 공개 이슈: <https://github.com/zzcx88/neo3ds/issues/new/choose> 에서 "버그 신고"를 고른다. 라벨은 `bug`가 붙는다.
- 예외: 제보 Worker의 GitHub 토큰, Cloudflare 시크릿, 릴리스 CI 시크릿이 관련된 문제는 공개 이슈에 쓰지 않고 저장소 소유자 [@zzcx88](https://github.com/zzcx88)의 GitHub 프로필로 비공개 연락한다. 공개된 재현 방법이 그대로 악용될 수 있는 경우다.
- 보고에 포함할 것: 영향 버전(릴리스 태그 또는 `<Version>`), 플랫폼, 재현 절차, 기대·실제 결과.
- **롬·바이오스·Azahar 키는 보내지 않는다.** 합성 zip이나 공개 홈브루로 재현한다 (`site/vendor/conv/conv.test.mjs`의 합성 셋 방식 참고).

## 지원 버전

- 최신 릴리스(현재 1.3.x)와 `main`만 수정 대상이다.
- 이전 릴리스에는 보안 수정을 백포트하지 않는다. 새 릴리스로 올린다.
- 버전 단일 출처는 `converter/Directory.Build.props`의 `<Version>`이다.

## 범위

대상:

- `engine/` — 3DS 엔진 (C, libctru)
- `converter/` — 오프라인 변환기 (C#)
- `site/vendor/conv/` — 웹 변환기 (JS, Worker, WASM)
- `worker/` — 익명 제보 Worker (Cloudflare Workers)
- `scripts/`, `.github/workflows/` — 빌드·배포 자동화

범위 밖 (일반 이슈로):

- 롬·바이오스 없이 변환이 안 되는 문제
- 에뮬레이션 정확도·속도 문제
- makerom, bannertool, devkitPro, Azahar 등 외부 도구 자체의 취약점 (각 프로젝트에 보고)

## 비밀 관리

- 롬, 바이오스(`neogeo.zip`), Azahar 키, CI 시크릿을 커밋하지 않는다. `.gitignore`가 `roms/`와 `tools/`를 제외한다.
- 제보 Worker는 게임 카탈로그 이름과 BIOS 구성 정보, 로그만 공개 이슈로 만든다. zip 파일명은 카탈로그 이름으로 치환되고 바이오스는 `BIOS`로 바뀐다 (`docs/adr/0001-web-usage-analytics.md`).
- 제보 Worker의 GitHub 토큰은 해당 저장소의 이슈 읽기·쓰기로만 제한한다 (`worker/wrangler.toml`).
- 실수로 비밀을 커밋했다면 공개 이슈에 쓰지 말고 소유자에게 비공개로 알린 뒤 값을 폐기·교체한다. 이력 재작성은 소유자가 판단한다.

## 응답

- 접수 후 가능한 한 빨리 확인한다. 별도 대응 기한(SLA)은 두지 않는다.
- 수정 릴리스가 나간 뒤 공개 시점과 내용을 신고자와 협의한다.
