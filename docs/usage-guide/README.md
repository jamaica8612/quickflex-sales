# PWA 사용법 안내 연결

## 진입점

- 설정 첫 화면의 **사용법**: 접힌 내 정보/계정 메뉴 밖에 배치합니다.
- 배송 측정의 **사용법 보기**: 기존 **설치 안내** 버튼과 별도로 배치합니다.
- 두 링크 모두 `./guide.html`을 새 창으로 엽니다. `noopener noreferrer`로 원래 페이지 접근을 차단하고 기존 PWA 화면/입력 상태를 유지합니다. 새 창 여부를 글자와 접근성 이름에 표시합니다.
- 안내 상단 **매출관리** 링크는 같은 사이트의 `./`를 엽니다. 설치 링크도 상대 경로여서 GitHub Pages 하위 경로와 오프라인 캐시에서 작동합니다.

## 소스와 생성

사용자가 승인한 `quickflex-guide/guide-template.html`을 이 폴더에 가져왔습니다. 디자인과 본문을 유지하면서 호스팅용 상대 경로와 매출관리 링크만 보완했습니다.

```powershell
node scripts/build-usage-guide.mjs
```

`guide.html`은 생성물입니다. 이 폴더의 `guide-template.html`과 `scripts/build-usage-guide.mjs`를 편집한 뒤 다시 생성하세요. 웹에서는 기존 `assets/fonts/PretendardVariable.woff2`를 재사용합니다. 큰 Base64 HTML을 매번 내려받지 않도록 가상 화면을 `assets/usage-guide/`의 독립 파일로 유지합니다.

## 가상 화면 출처

Android `C:\work\quickflex-route-finish-review-20260914`의 `artifacts/flexmeter-a-ledger/` Compose Preview입니다. UI 기준 `148c443`, Beta 1.07 배포 기록 `391f3c4`.

| 웹 자산 | Preview 원본 |
| --- | --- |
| `pace.png` | `flexmeter-measuring-ahead-dark-384.png` |
| `finish.png` | `flexmeter-finish-read-dark-384.png` |
| `edit.png` | `flexmeter-finish-edit-mismatch-dark-384.png` |

구역 `316C`, `316D`와 상세 코드, 수량, 날짜는 모두 가상 fixture입니다. 실제 고객 이름·주소·송장·계정·매출이나 사용자 첨부 사진을 포함하지 않습니다. 로고는 기존 소개 자료의 `flexnote-symbol.svg`이며 앱 아이콘 파일은 변경하지 않았습니다.

## 범위

정적 사용법/진입 링크/오프라인 자산 등록만 변경합니다. 집계, 매출 저장, 로그인, Android APK, 서버와 DB 로직은 변경하지 않습니다. 원래 설치 모달 핸들러와 APK 링크는 유지합니다. 설치 모달의 간단한 업무 안내도 **쿠팡플렉스 배송목록 화면을 열어주세요**로 명확히 표현했습니다.

`sw.js` 캐시 이름에 `usage-guide-1`을 추가하고 안내 및 이미지들을 precache에 포함했습니다. 앱/API 버전과 APK 버전은 변경하지 않습니다.

## 검증

```powershell
node --test --test-concurrency=1 tests/pwa-usage-guide.test.mjs tests/pwa-accessibility.test.mjs tests/pwa-native-back.test.mjs tests/pwa-sales-override.test.mjs tests/pwa-fonts.test.mjs
node scripts/check-usage-guide.mjs
```

2026-09-14 검증 결과:

- 관련 Node 테스트 34개 통과. 첫 병렬 실행은 PC 메모리 부족으로 실행기가 종료되어, 동시성을 1로 줄여 재검증했습니다.
- 320/390/768/1440px, 밝은/어두운 테마에서 두 진입 링크 표시·초점·44px 터치 영역·가로 넘침 확인.
- 두 진입점 모두 정상적인 새 창 이동, `window.opener === null`, 원래 PWA 화면과 날짜 입력 유지 확인.
- 실제 서비스 워커로 안내를 미리 캐시한 뒤 네트워크를 끊고 안내와 확대 이미지 3장 로딩, Esc/초점 복원 확인.
- `app.js`, `sw.js`, 추가 스크립트 문법 및 diff 검사.

브라우저 검증의 PWA 부분은 실제 HTML/CSS에 가상값을 넣은 격리 fixture이며 계정/API 모듈을 실행하지 않습니다. 안내 본문과 서비스 워커는 실제 코드를 실행합니다. 실제 계정·실기기 검증이나 외부 배포를 의미하지 않습니다.

결과는 `artifacts/usage-guide/checks.json`, `measurement-*-390.png`, `settings-*-390.png`, `guide-offline-390.png`입니다. 브라우저 실행 경로는 `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` 환경변수로 변경할 수 있습니다.
