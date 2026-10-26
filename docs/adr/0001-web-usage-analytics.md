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
