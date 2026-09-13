# 자료 내보내기 계약

`src/lib/export-records.js`는 브라우저에서 실제 XLSX 또는 XLSX와 증빙을 담은 ZIP을 생성한다. ExcelJS와 fflate는 사용자가 내보내기를 시작할 때만 `src/vendor/`에서 불러온다.

```js
await downloadRecordsExport({
  sales,
  expenses,
  from: "2026-09-01",
  to: "2026-09-30",
  includeReceipts: true,
  fetchReceipt: (receipt, expense) => expenseService.downloadReceipt(receipt, expense),
  onProgress: ({ stage, completed, total }) => {},
  businessInfo: { displayName: "표시명", registrationNumber: "선택 입력" },
});
```

매출 입력은 앱의 일별 정본만 받는다. 각 행의 `revenue`가 총매출이며 `deliveryRevenue`, `freshRevenue`, `backupRevenue`, `routeDetails`를 다시 합쳐 총매출을 만들지 않는다. 지출은 `draft`, `confirmed`, `trashed` 상태와 `receipts`, `adjustments`를 포함한 DB 응답 형식을 사용한다. 초안과 미확정 금액은 공식 합계에서 제외하고 `needs_review`에 남긴다.

증빙 다운로드 함수에는 비공개 저장소에서 현재 사용자 소유 파일을 인증하여 가져오는 함수를 넘긴다. 내보내기 라이브러리는 `object_path`를 XLSX에 기록하지 않고 `receipts/<지출 ID>/<증빙 ID>-<안전한 파일명>` 상대 경로만 기록한다. 가져오기 실패는 ZIP을 중단하지 않고 `evidence_index`의 상태와 실패 사유에 남긴다. 알려진 파일 크기 또는 실제 수신 크기가 기본 75 MiB 한도를 넘으면 `ExportSizeLimitError`를 내고 월별 기간을 제안한다.

`createExportsController({ host, getExportInput, fetchReceipt, onDownload })`는 접근 가능한 모달을 만든다. `open({ from, to })`, `close()`, `reset()`을 제공한다. 로그아웃 때 `reset()`을 호출한다. `styles/exports.css`를 앱 문서에 연결해야 한다. `getExportInput({ from, to })`는 `{ sales, expenses, businessInfo }`를 반환해야 하며, 테이블 부재나 로드 실패를 빈 배열로 바꾸지 말고 오류로 전달한다.

내보내기 시작 시 배열과 사업자 표시정보를 복제하므로 생성 중 화면 데이터가 바뀌어도 파일은 한 시점의 자료를 유지한다. `=`, `+`, `-`, `@`로 시작하는 거래처·메모 등 문자열은 Excel 수식이 되지 않도록 리터럴로 저장한다.
