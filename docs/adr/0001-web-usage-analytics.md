# 웹 변환기 사용 통계: Umami Cloud Hobby + 쿠키 없는 이벤트

`site/`는 GitHub Pages 정적 배포라 서버 로그가 없다. 방문·퍼널·오류·게임 인기도를 수집하려면 클라이언트 계측이 필요하고, 쿠키·동의 배너 없이 집계하기 위해 Umami Cloud Hobby($0, 100K 이벤트/월, 1 사이트, 6개월 보존)를 쓴다. 페이지뷰는 자동 수집하고, 변환 흐름에서 `convert_start`(mode), `convert_done`(game), `convert_fail`(game, stage)만 추가로 보낸다. 게임 식별자는 공개 카탈로그의 롬셋 이름(`game.name`)이며 사용자가 올린 zip 파일명은 전송하지 않는다. 개인정보 처리 내용은 `site/privacy.html`에 한국어·영어로 명시한다.

## Considered Options

- **Plausible**: 쿠키 없음·EU 호스팅이지만 커스텀 프로퍼티가 Business($19/월)에만 있어 제외.
- **Cloudflare Web Analytics**: 무료이고 프록시 없이 스니펫만으로 동작하지만 커스텀 이벤트를 지원하지 않아 퍼널 측정 불가.
- **GoatCounter**: 공개·비상업 무료, 이벤트는 이름(경로)만 지원하고 프로퍼티가 없어 게임별 집계 불가.
- **PostHog Free**: 1M 이벤트/월이지만 SDK가 무겁고 이 규모에 과함.
- **자체 비콘**(Cloudflare Workers + Analytics Engine): 통제력은 최대지만 보존 3개월, 쿼리·대시보드를 직접 구현해야 함.
- **GA4**: 무료지만 동의 배너가 필요하고 스크립트가 무거움.

## Consequences

- Umami 사용량은 페이지뷰 1건과 **저장된 프로퍼티 1개**를 각각 1이벤트로 센다 → 프로퍼티 수를 최소화한다(`convert_fail`은 3이벤트).
- 광고 차단기 사용자는 집계에서 빠진다(모든 클라이언트 계측 공통).
- 보존이 6개월이므로 장기 추세는 CSV 내보내기로 보관한다.
- 변환 실패는 단계(`load|romfs|art|cia`)까지만 기록한다. 차단 사유 코드는 필요해지면 별도로 추가한다.
- 페이지의 `stats.rom`은 사용자가 올린 zip 파일명이므로 게임 식별자로 쓰지 않는다. 워커가 정규 롬셋 이름(`set`)을 함께 보내야 한다.

## Amendment 2026-10-28 (#175)

이벤트를 늘리지 않고 값에 정보를 접어 넣는 방향으로 계약을 넓혔다. 프로퍼티 수는 그대로라 과금 단가도 그대로다.

- **이벤트 4개**: `convert_start(mode)`, `convert_done(game)`, `convert_fail(game, stage)`, `convert_save(mode)`.
  - `mode` 값에 배치 규모를 접는다: `batch:2`·`batch:3-5`·`batch:6+`.
  - `stage` 값에 실패 사유를 접는다: `load/bios`·`load/notromset`·`load/missing`·`load/zip`·`load/nofile`·`art/image`·`romfs/oom`·`cia/wasm`·`worker/crash`·`.../unknown`.
  - `convert_save`는 변환 완료가 아니라 **다운로드 클릭**에서만 발생한다. 변환은 했지만 파일을 가져가지 않은 경우를 구분하기 위해서다.
- 사유 코드는 워커가 오류에 싣는 기계용 값이며, 사람이 보는 메시지는 그대로 지역화한다. 코드 목록은 `site/vendor/conv/analytics.js`가 화이트리스트로 닫고 `conv.test.mjs`가 고정한다.
- 새 값도 개인 식별자가 아니다. `site/privacy.html` KO/EN과 `docs/build.md` §7.1을 같은 커밋에서 갱신했다.

## Amendment 2026-10-30 (#189)

제보 제출을 다섯 번째 이벤트로 추가했다. 속성이 없어 저장 프로퍼티가 늘지 않는다(과금 단가 동일).

- **이벤트 1개 추가**: `feedback_submit` — 제보 Worker가 이슈를 만든 뒤 성공했을 때만 1회. 프로퍼티 없음.
- 제보 본문(증상·로그·실패 게임·UA)은 분석 이벤트가 아니라 공개 GitHub 이슈로만 간다. 게임 식별자는 계속 공개 카탈로그의 `set`이며, zip 파일명은 제보 로그에서도 카탈로그 이름으로 치환된다(BIOS `neogeo.zip`은 `BIOS`).
- 새 이벤트도 개인 식별자가 아니다. `site/privacy.html` KO/EN과 `docs/build.md` §7.1을 같은 커밋에서 갱신했다.

## Amendment 2026-10-30 (#202)

제보 본문에 BIOS 구성 프로필을 추가했다. 이벤트는 늘지 않고, 이 필드는 분석 이벤트가 아니라 공개 이슈에만 실린다.

- `bios` 필드: `neogeo.zip` 존재 여부, ZIP 읽기 실패, CRC+size가 일치하는 AES/MVS 칩 이름·지역, `sfix.sfix`/`000-lo.lo`의 `ok|missing`.
- `neogeo.zip` 파일명·엔트리 원본 이름·롬 바이트는 보내지 않는다. 알려진 슬롯 이름과 세 지역 라벨만 화이트리스트로 전송한다.
- 프로필은 ZIP 중앙 디렉터리만 읽어 만들며, 엔트리를 inflate하지 않는다.
- `site/privacy.html` KO/EN과 `docs/build.md` §7.3을 같은 커밋에서 갱신했다.
