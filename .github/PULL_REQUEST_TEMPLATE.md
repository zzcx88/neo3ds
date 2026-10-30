## 변경 요약

<!-- 무엇이 바뀌었고 왜 필요한지 2~3줄 -->

## 관련 이슈

관련 이슈 #

## 검증

실행한 명령과 결과(통과/실패, 실패 시 첫 줄)를 적는다:

```sh
bash scripts/site_gate.sh
```

## 체크리스트

- [ ] 롬·바이오스·빌드 산출물(`engine/*.elf`, `dist/`, `out/`, `tools/`)이 커밋에 없다
- [ ] 무관한 변경이 섞이지 않았다
- [ ] 한·영 쌍 문서를 같은 커밋에서 갱신했다 (`README.md`↔`README.ko.md`, `docs/TECHNICAL.md`↔`docs/TECHNICAL.ko.md`, `site/` i18n 키)
- [ ] 생성 파일을 스크립트로 재생성했다 (`site/games.js`, `site/changelog.html`, `CHANGELOG.md`)
- [ ] 엔진 동작을 바꿨으면 `bash scripts/azahar_test.sh`를 통과했다 (Windows)
- [ ] 실기 확인 없이 호환성 표를 "확인"으로 바꾸지 않았다
