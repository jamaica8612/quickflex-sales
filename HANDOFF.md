> 초기 홈 리프레시의 과거 기록입니다. 현재 디자인 기준은 DESIGN-RULES.md, 최신 구현·검증 상태는 docs/WORKLOG.md와 docs/design-audit-2026-09-13.md를 참고하세요. 아래 미완료 목록과 되돌리기 명령은 현재 작업 지시가 아닙니다.

# 인수인계 — PWA 홈 리프레시 (2026-09)

## 지금 어디까지 왔나

| | |
|---|---|
| 작업 위치 | `C:\work\quickflex-sales-redesign` (git worktree) |
| 브랜치 | `design/home-refresh` |
| 베이스 커밋 | `ba54242` (깃허브 HEAD) |
| 변경 파일 | `styles.css`, `index.html`, `src/main.js` |

**원본 작업 폴더 `C:\work\quickflex-sales-cancel-fix` 는 건드리지 않았습니다.** 그쪽 미커밋 변경분은 태그 `redesign-backup`(`b73c9de`)에 스냅샷해 뒀습니다.

`styles.css` 변경은 전부 파일 끝의 `2026-09 홈 리프레시` 블록(섹션 1~18)에 모여 있습니다. 앞쪽 토큰 블록(`:root`, `[data-theme="dark"]`)만 직접 수정했습니다.

되돌리기: `git checkout ba54242 -- styles.css index.html src/main.js`

---

## 이 리디자인의 진단 (건드리지 말 것)

사용자가 "촌스럽다"고 한 원인은 자간·여백이 아니라 셋이었습니다. **이 세 가지를 되돌리면 작업이 무의미해집니다.**

1. **글자가 전부 굵었다** — `650·680·750·760·800·850·900` 일곱 단계. 한국어 UI가 촌스러워 보이는 가장 흔한 원인. → **500·600·700·800 네 단계로 고정**
2. **모든 요소에 1px 테두리** — 선으로 나누면 전부 같은 층에 눌러붙어 평평해진다. → **표면·그림자로 층을 만든다.** 단 달력 괘선은 표의 구조라 유지
3. **강조색이 쨍했다** — 다크 `#FFD24A`는 형광에 가깝다. → **`#E8B85C`**, 라이트는 `#1A73E8` → `#1B62D6`

추가 원칙
- 폰트: 숫자 **Archivo**, 한글 **IBM Plex Sans KR**, 코드/시각 **JetBrains Mono** (셋 다 SIL OFL, Google Fonts `@import`)
- 모든 수치에 `tabular-nums`
- 숫자 뒤 단위(원·건·일)는 한 단계 작게 + muted
- 강조색은 상태와 주 버튼에만. 한 화면에서 유채색 3곳 이하
- 일상점검은 **주인공이 아니다** — 요약 카드 안, 무채색

---

## 완료된 변경 (styles.css 섹션 번호)

| # | 내용 |
|---|---|
| 1 | 글자 굵기 네 단계로 정리, 숫자 Archivo + tabular, `#periodRange` 모노 |
| 2 | 카드 테두리 → 표면·그림자. 예상액 32→34px, 자간 −0.035em |
| 3 | 일상점검을 요약 카드 안으로 (`index.html`에서 DOM 이동) |
| 4 | 홈 헤더 하늘색 그라데이션 → 강조색 기반 옅은 톤 |
| 5 | 달력 행 76→78px, 라우트 줄 모노 + 한 줄 말줄임 |
| 6 | 구역별 매출 행 상자 제거 → 괘선 |
| 7 | 하단 독, 부 버튼 높이 차등 |
| 8 | 매출/건수 토글을 세그먼트로 축소 |
| 11 | 토글을 달력 툴바 한 줄 안으로 (`index.html`에서 DOM 이동) |
| 12 | 날짜 상세 행 높이 **62px 고정** (세부구역 유무로 들쭉날쭉했음) |
| 13 | 목표 진행바 6스톱 그라데이션 + 글로우 + 4.2초 광택 스윕 |
| 14 | 달 이름 화면 정중앙 절대 정렬 |
| 15 | 하단 내비 아이콘 교체 — 달력=달력, 측정=계기 (`index.html`) |
| 16 | 정산예상액 카드 존재감 복구 (하이라이트 + 2단 그림자 + 얇은 테두리) |
| 17 | 달 이동 화살표를 달 이름 좌우로 (`‹ 2026년 9월 ›`), 오늘=왼쪽 끝 / 토글=오른쪽 끝 |
| 18 | 요일별 매출 섹션 스타일 |

`index.html` 변경: 점검 카드 이동, 토글 이동, 내비 아이콘 2개 교체, `#weekdayStats` 섹션 추가
`src/main.js` 변경: `el.weekdayStats` 등록, `renderWeekdayStats(keys)` 추가 + `renderStats()`에서 호출, `compactMoneyLabel()` 추가

**요일별 매출은 합계가 아니라 근무일당 평균으로 세웠습니다.** 합계로 하면 근무일이 많은 요일이 무조건 이겨서 "토요일이 좋다"가 아니라 "토요일에 많이 일했다"만 보입니다. 각 막대 아래 표본(근무일수)을 함께 적어 과신을 막습니다. 이 판단은 유지해 주세요.

---

## 지금 해야 할 일 (사용자 요청, 미완)

### A. "흐름 · 매출 추이" 카드를 빼고 그 자리에 요일별 매출을 넣는다

- `index.html` 의 `<section class="stats-chart-card stats-report-section" ...>` 블록 전체 삭제 (대략 308~327행)
- `#weekdayStats` 섹션(`요일 분포 / 요일별 매출`)을 삭제한 자리로 이동 — 즉 통계 리포트의 **첫 섹션**이 되게

**안전 확인 완료.** 차트 관련 참조는 전부 null 가드가 있어 섹션을 지워도 런타임 에러가 없습니다.

```
src/main.js:4115  if (el.statsChartEmpty) ...
src/main.js:4116  if (el.statsChart) ...
src/main.js:4118  if (el.statsChartToggle) ...
src/main.js:4122  if (el.statsChartTooltip) ...
src/main.js:4132  if (!el.statsChartToggle) return;
src/main.js:4402  const canvas = el.statsChart;
src/main.js:4403  if (!canvas) return;          ← renderStatsChart 첫 줄 가드
src/main.js:4521  if (!canvas || !...) return;
src/ui/stats.js:107  if (el.statsChartToggle) {
src/ui/stats.js:119  if (el.statsChart) {
```

`renderStatsChart` · `statsChartState` · 차트 이벤트 핸들러는 죽은 코드가 됩니다. **당장 지우지 마세요** — 사용자가 되살릴 수 있습니다. 주석으로 "미사용, 차트 섹션 제거됨(2026-09)"만 남기면 충분합니다.

### B. 요일별 막대가 너무 뚱뚱하다

현재 `.wd-bars`는 7열 균등 그리드 + `gap: 6px` 이라 400px 화면에서 막대 폭이 **40px 넘습니다.**

고칠 지점 (`styles.css` 섹션 18)

```css
.wd-track { /* 지금은 width:100% */ }
.wd-col   { grid-template-rows: 16px 96px 16px 13px; }
```

권장
- `.wd-track { width: 100%; max-width: 20px; margin: 0 auto; }` — 막대만 좁히고 터치 영역(칼럼)은 유지
- 높이 `96px → 76px` 검토. 값 차이가 19만~24만으로 좁아 96px은 과합니다
- `border-radius`는 막대가 좁아지면 `6px → 4px`

막대를 좁힌 뒤 `.wd-avg`(10.5px 금액)가 칼럼 폭을 넘지 않는지 확인하세요. 넘으면 `9.5px`로 낮추거나 최고 요일만 표시.

---

## 검증 방법 (로그인 없이 화면 확인)

앱에 로그인 게이트가 있어 실데이터 없이는 홈이 안 보입니다. 정적 서버 + DOM 주입 하네스로 시각 확인만 합니다.

**1) 정적 서버** (`srv.js`로 저장 후 `node srv.js C:/work/quickflex-sales-redesign`)

```js
const http=require("http"),fs=require("fs"),path=require("path");
const root=process.argv[2],port=8731;
const T={".html":"text/html;charset=utf-8",".css":"text/css;charset=utf-8",".js":"text/javascript;charset=utf-8",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".woff2":"font/woff2",".webmanifest":"application/manifest+json"};
http.createServer((q,r)=>{
  let f=decodeURIComponent(q.url.split("?")[0]); if(f==="/")f="/index.html";
  const fp=path.join(root,f);
  fs.readFile(fp,(e,d)=>{ if(e){r.writeHead(404);r.end("404");return;}
    r.writeHead(200,{"Content-Type":T[path.extname(fp)]||"application/octet-stream"}); r.end(d); });
}).listen(port,()=>console.log("http://localhost:"+port));
```

**2) 브라우저 콘솔에서 로그인 게이트 숨기고 뷰 전환**

```js
document.documentElement.setAttribute('data-theme','dark');
document.body.setAttribute('data-theme','dark');
document.getElementById('app').setAttribute('data-view','stats');   // 또는 'home'
const t=document.getElementById('authTitle');
let n=t; while(n&&n!==document.body){
  const cs=getComputedStyle(n);
  if(cs.position==='fixed'||n.classList.contains('overlay')){ n.style.display='none'; break; }
  n=n.parentElement;
}
```

**3) 같은 와이파이 폰에서 보기** — `http://192.168.219.112:8731`
네트워크가 Public이면 관리자 PowerShell에서 한 번:
`New-NetFirewallRule -DisplayName "quickflex-preview-8731" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8731 -Profile Public -RemoteAddress LocalSubnet`

**4) 라이트/다크 양쪽 확인 필수.** 토큰을 거치지 않은 하드코딩 색이 하나라도 남으면 한쪽이 깨집니다.

---

## 손대면 안 되는 것

- Supabase 스키마, 정산 계산, 취소·반품 회계 — **표시 계층만** 바꿉니다
- 일상점검 기능 자체 (홈에서 자리만 옮겼고 진입 경로는 유지)
- `src/lib/route.js` 의 `compactRouteList` — 달력 라우트 표기가 여기 의존합니다

## 검증

`node --check src/main.js` 통과 확인. `tests/`는 Pretendard/Wanted Sans를 검증하는 항목(`tests/pwa-fonts.test.mjs`)이 있어 폰트 교체로 실패할 수 있습니다. **기대값을 새 폰트로 갱신**하되, 다른 테스트가 깨지면 원인을 찾아 고치세요.

---

## 백로그 — 사용자가 나중에 고르기로 한 통계

우선순위 순. 사용자에게 확인 후 진행하세요.

**지금 데이터로 바로 가능**
1. **시급 (매출 ÷ 실근무시간)** — 건수는 구역 난이도가 달라 비교가 안 되지만 시급은 됩니다. 측정 앱이 활성시간을 이미 잽니다
2. **구역별 시급** — 구역 배정을 고를 수 있다면 바로 돈이 되는 정보
3. 하루 최고 기록 (최고 매출일·건수일·시급일)
4. **목표 달성 예측** — "이 페이스면 정산일에 598만원, 목표까지 2,600원" + 남은 근무일 × 필요 일평균
5. 연속 근무일 / 누적 근무일
6. 반품·취소 비율 추이
7. 프레시백 회수율

**측정 앱 데이터와 합치면 가능**
8. **날씨별 페이스·매출** — 측정 앱이 이미 날씨를 수집합니다. 이 앱에만 있는 데이터라 차별점이 큼
9. 시간대별 배송 속도
10. 구역별 밀도 (건수 ÷ 소요시간)

**새 입력 필요**
11. **실수령 (유류비·통행료 차감)** — 기사들이 가장 크게 착각하는 지점
12. km당 매출
13. 세금 예상 (3.3% 원천징수 + 종소세 대략)

사용자에게 추천한 순서는 **1 → 4 → 8 → 11** 입니다.
