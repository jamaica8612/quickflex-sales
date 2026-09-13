const CATEGORIES = [['fuel','주유 · 충전'],['vehicle','차량 정비'],['toll','통행료 · 주차'],['insurance','보험'],['lease','차량 임차'],['supplies','배송 용품'],['communication','통신'],['other','기타']];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (value) => Number(value ?? 0).toLocaleString('ko-KR');
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const label = (code) => CATEGORIES.find(([key]) => key === code)?.[1] || '기타';
const options = (items, selected) => items.map(([key,value]) => `<option value="${esc(key)}"${key===selected?' selected':''}>${esc(value)}</option>`).join('');
const blankNumber = (value) => value === '' || value == null ? null : Number(value);
const errorText = (error) => /schema cache|does not exist|could not find.*quickflex/i.test(error?.message || '') ? '지출 저장 기능을 준비 중입니다. 연결이 완료되면 사용할 수 있습니다.' : error?.message || '잠시 후 다시 시도해 주세요.';
const adjustmentSum = (row, kind) => (row.adjustments || []).filter((a) => a.kind === kind).reduce((n,a) => n+Number(a.amount),0);

/** The service owns persistence. No receipt or financial data is kept in browser storage. */
export function createExpensesController({host,getService,toast=()=>{}}) {
  let rows=[],month=localDate().slice(0,7),filter='all',generation=0,disposed=false;
  let saveOperation=null,creationInput=null,cleanupPath=null;
  let draft=null,pendingFiles=[],busy=false,dialog=null,previewUrls=[];
  const alive = (token) => !disposed && token===generation;
  function bounds() {
    const [year,mm]=month.split('-').map(Number);
    return {from:`${month}-01`,to:`${month}-${new Date(year,mm,0).getDate()}`};
  }
  const report = (message) => { const status=dialog?.querySelector('[data-status]'); if(status)status.textContent=message; };
  function revoke() { previewUrls.forEach((url)=>URL.revokeObjectURL(url)); previewUrls=[]; }
  function close(force=false) {
    if (busy&&!force) return false;
    revoke(); dialog?.close(); dialog?.remove(); dialog=null; draft=null; pendingFiles=[];
    return true;
  }
  function showFrame(content) {
    host.innerHTML=`<section class="expense-summary"><span class="expense-eyebrow">지출 기록</span><div class="expense-month-control"><button type="button" class="round-btn" data-month="-1" aria-label="이전 지출 월">‹</button><label><span class="sr-only">지출 월</span><input type="month" data-month-input value="${month}" /></label><button type="button" class="round-btn" data-month="1" aria-label="다음 지출 월">›</button></div><div data-summary></div></section><div class="expense-actions"><button class="full-btn" type="button" data-new>지출 기록</button><button class="secondary-btn" type="button" data-inbox>영수증만 보관</button></div><div class="expense-filter"><label for="expenseFilter">기록 보기</label><select id="expenseFilter" data-filter>${options([['all','저장한 지출'],['draft','작성 중'],['missing','증빙 미첨부'],['trashed','휴지통']],filter)}</select></div><section class="expense-list" aria-label="지출 내역" aria-live="polite">${content}</section>`;
  }
  function render() {
    const confirmed=rows.filter((r)=>r.status==='confirmed'&&r.actual_date>=bounds().from&&r.actual_date<=bounds().to);
    const gross=confirmed.reduce((n,r)=>n+Number(r.gross_amount||0),0);
    const refunds=confirmed.reduce((n,r)=>n+adjustmentSum(r,'refund'),0);
    const reimbursements=confirmed.reduce((n,r)=>n+adjustmentSum(r,'reimbursement'),0);
    const visible=rows.filter((r)=> filter==='trashed' ? r.status==='trashed' : filter==='draft' ? r.status==='draft' : filter==='missing' ? r.status==='confirmed'&&!r.receipts?.length : r.status==='confirmed');
    showFrame(visible.length ? visible.map((r)=>`<button class="expense-row" type="button" data-expense="${esc(r.id)}"><span class="expense-row-copy"><strong>${esc(r.merchant||label(r.category))}</strong><small>${esc(r.actual_date?.slice(5).replace('-','.')||'날짜 미입력')} · ${esc(label(r.category))}${r.status==='draft'?' · 작성 중':''}</small><span class="expense-evidence">${r.receipts?.length ? `증빙 ${r.receipts.length}개` : '증빙 미첨부'}${adjustmentSum(r,'refund')?' · 환불 있음':''}${adjustmentSum(r,'reimbursement')?' · 보전 있음':''}</span></span><span class="expense-row-amount">${r.gross_amount==null?'금액 미입력':money(r.gross_amount)+'<small>원</small>'}<span aria-hidden="true">›</span></span></button>`).join('') : `<div class="expense-empty"><span class="expense-empty-icon" aria-hidden="true">＋</span><strong>${filter==='all'?'이번 달 지출을 기록해 보세요':filter==='draft'?'작성 중인 기록이 없습니다':filter==='trashed'?'휴지통이 비어 있습니다':'증빙 미첨부 기록이 없습니다'}</strong><p>영수증을 먼저 보관하고<br>날짜와 금액은 나중에 채워도 됩니다.</p></div>`);
    host.querySelector('[data-summary]').innerHTML=`<p class="expense-total">${money(gross-refunds)}<small>원</small></p><p class="expense-summary-note">${confirmed.length}건 · 환불 반영 지출</p>${refunds||reimbursements?`<p class="expense-summary-note">환불 ${money(refunds)}원 · 비용 보전 ${money(reimbursements)}원</p>`:''}<p class="expense-summary-note">작성 중 ${rows.filter((r)=>r.status==='draft').length}건은 합계에서 제외</p>`;
  }
  async function refresh() {
    const token=++generation;
    showFrame('<p class="expense-empty" role="status">지출을 불러오고 있습니다.</p>');
    try {
      const service=await getService();
      const result=await service.list({...bounds(),includeDrafts:true,includeTrashed:true});
      if(!alive(token))return;
      rows=result; render();
    } catch(error) {
      if(!alive(token))return;
      showFrame(`<div class="expense-empty"><strong>지출 연결 확인이 필요합니다</strong><p>${esc(errorText(error))}</p><button type="button" class="secondary-btn" data-retry>다시 불러오기</button></div>`);
    }
  }
  function setBusy(value) {
    busy=value;
    if(!dialog)return;
    dialog.setAttribute('aria-busy',String(value));
    dialog.querySelectorAll('button,input,select,textarea').forEach((node)=>node.disabled=value);
  }
  function renderFiles() {
    const target=dialog?.querySelector('[data-files]');
    if(!target)return;
    target.innerHTML=(draft.receipts||[]).map((r,i)=>`<button type="button" class="expense-file" data-preview="${i}"><span>증빙 ${i+1}</span><small>보기 ↗</small></button>`).join('')+pendingFiles.map((entry,i)=>`<div class="expense-file"><span>${esc(entry.file.name)}</span><button type="button" data-remove-file="${i}" aria-label="${esc(entry.file.name)} 첨부 취소">×</button></div>`).join('');
  }
  function open(row=null,inbox=false) {
    close();
    draft=row?structuredClone(row):{request_id:crypto.randomUUID(),status:'draft',actual_date:inbox?null:localDate(),category:'other',usage_type:'business',receipts:[],adjustments:[]};
    pendingFiles=[];saveOperation=null;creationInput=null;cleanupPath=null;
    dialog=document.createElement('dialog');dialog.className='expense-dialog';dialog.setAttribute('aria-labelledby','expenseEditorTitle');
    const trashed=draft.status==='trashed';
    dialog.innerHTML=`<form data-editor novalidate><header class="expense-dialog-head"><div><span class="expense-eyebrow">${inbox?'영수증 보관':row?'지출 기록':'새 지출'}</span><h2 id="expenseEditorTitle">${inbox?'사진부터 남겨두세요':row?'지출 수정':'얼마를 쓰셨나요?'}</h2></div><button type="button" class="round-btn" data-close aria-label="지출 창 닫기">×</button></header><div class="expense-dialog-body"><div class="expense-file-actions"><button type="button" class="secondary-btn" data-camera>사진 촬영</button><button type="button" class="secondary-btn" data-upload>사진 · PDF 선택</button><input data-camera-input type="file" accept="image/*" capture="environment" hidden /><input data-upload-input type="file" accept="image/*,application/pdf" multiple hidden /></div><div data-files class="expense-files"></div><div class="expense-fields"><label class="expense-amount-field">총 금액 <span>원</span><input name="gross_amount" type="number" inputmode="numeric" min="0" step="1" value="${esc(draft.gross_amount)}" placeholder="금액 입력" /></label><label>지출 날짜<input name="actual_date" type="date" value="${esc(draft.actual_date)}" /></label><label>분류<select name="category">${options(CATEGORIES,draft.category)}</select></label><label class="expense-field-full">사용처<input name="merchant" maxlength="100" value="${esc(draft.merchant)}" placeholder="예: 주유소, 정비소" /></label></div><details class="expense-more"><summary>결제 · 세금 참고 정보</summary><div class="expense-fields"><label>결제수단<select name="payment_method">${options([['unknown','미입력'],['card','카드'],['cash','현금'],['transfer','계좌이체'],['other','기타']],draft.payment_method||'unknown')}</select></label><label>증빙 종류<select name="evidence_type">${options([['unknown','미확인'],['card','카드 영수증'],['cash_receipt','현금영수증'],['tax_invoice','세금계산서'],['receipt','일반 영수증'],['other','기타']],draft.evidence_type||'unknown')}</select></label><label>공급가액<input name="supply_amount" type="number" inputmode="numeric" min="0" step="1" value="${esc(draft.supply_amount)}" placeholder="확인한 경우 입력" /></label><label>부가세<input name="vat_amount" type="number" inputmode="numeric" min="0" step="1" value="${esc(draft.vat_amount)}" placeholder="확인한 경우 입력" /></label><label>사용 구분<select name="usage_type">${options([['business','업무용'],['personal','개인용'],['mixed','업무 · 개인 혼합']],draft.usage_type||'business')}</select></label><label>업무 사용 금액<input name="business_amount" type="number" inputmode="numeric" min="0" step="1" value="${esc(draft.business_amount)}" placeholder="확인한 경우 입력" /></label></div><p class="expense-help">공제 여부는 확정하지 않습니다. 확인하지 않은 세액은 비워두세요.</p></details><label class="expense-memo">메모<textarea name="memo" maxlength="1000" rows="2" placeholder="지출에 대해 남길 내용">${esc(draft.memo)}</textarea></label>${row&&!trashed?`<details class="expense-more"><summary>환불 · 비용 보전 기록</summary><div data-adjustments>${(draft.adjustments||[]).map((a)=>`<p>${a.kind==='refund'?'환불':'비용 보전'} · ${esc(a.actual_date)} · ${money(a.amount)}원</p>`).join('')||'<p class="expense-help">환불이나 회사에서 돌려받은 금액을 따로 기록합니다.</p>'}</div><div class="expense-fields"><label>구분<select data-adjust-kind><option value="refund">환불</option><option value="reimbursement">비용 보전</option></select></label><label>금액<input data-adjust-amount type="number" inputmode="numeric" min="1" step="1" /></label><label>받은 날짜<input data-adjust-date type="date" value="${localDate()}" /></label><label>메모<input data-adjust-memo maxlength="500" /></label></div><button type="button" class="secondary-btn" data-adjust>추가</button></details>`:''}<p data-status class="expense-form-status" role="status" aria-live="polite"></p></div><footer class="expense-dialog-footer">${trashed?'<button type="button" class="full-btn" data-restore>지출 복원</button>':'<button type="button" class="secondary-btn" data-draft>임시 저장</button><button type="submit" class="full-btn">지출 저장</button>'}</footer>${row&&!trashed?'<button type="button" class="expense-trash" data-trash>휴지통으로 이동</button>':''}</form>`;
    document.body.append(dialog);
    if(trashed)dialog.querySelectorAll('.expense-dialog-body input,.expense-dialog-body select,.expense-dialog-body textarea,.expense-file-actions button').forEach((node)=>node.disabled=true);
    dialog.addEventListener('cancel',(event)=>{event.preventDefault();close();});
    dialog.addEventListener('click',onDialogClick);
    dialog.addEventListener('change',(event)=>{
      if(!event.target.matches('[type="file"]'))return;
      for(const file of event.target.files||[]) {
        if(pendingFiles.length+(draft.receipts||[]).length>=10){report('한 기록에 최대 10개까지 첨부할 수 있습니다.');break;}
        if(file.size>10*1024*1024){report('파일 하나는 10MB 이하로 선택해 주세요.');continue;}
        if(!file.type.startsWith('image/')&&file.type!=='application/pdf'){report('사진 또는 PDF 파일을 선택해 주세요.');continue;}
        pendingFiles.push({file,requestId:crypto.randomUUID()});
      }
      event.target.value='';renderFiles();
    });
    dialog.querySelector('form').addEventListener('submit',(event)=>{event.preventDefault();save('confirmed');});
    renderFiles();dialog.showModal();
    if(inbox)dialog.querySelector('[data-upload]').focus();
  }
  function readInput(status) {
    const data=new FormData(dialog.querySelector('form'));
    return {...draft,status,actual_date:data.get('actual_date')||null,gross_amount:blankNumber(data.get('gross_amount')),category:data.get('category'),merchant:data.get('merchant')?.trim()||'',memo:data.get('memo')?.trim()||'',payment_method:data.get('payment_method'),evidence_type:data.get('evidence_type'),supply_amount:blankNumber(data.get('supply_amount')),vat_amount:blankNumber(data.get('vat_amount')),business_amount:blankNumber(data.get('business_amount')),usage_type:data.get('usage_type')};
  }
  async function save(status) {
    if(busy||!draft)return;
    const input=readInput(status);
    if(status==='confirmed'&&(!input.actual_date||(input.gross_amount==null||input.gross_amount<1))){report('지출 날짜와 1원 이상의 총 금액을 입력해 주세요. 사진만 보관하려면 임시 저장을 눌러주세요.');return;}
    if(!dialog.querySelector('form').reportValidity())return;
    const payloadKey=JSON.stringify(Object.fromEntries(Object.entries(input).filter(([key])=>!['id','request_id','receipts','adjustments','created_at','updated_at','user_id'].includes(key))));
    if(saveOperation?.payloadKey!==payloadKey)saveOperation={payloadKey,requestId:crypto.randomUUID()};
    const token=generation,activeDialog=dialog;
    setBusy(true);report('저장하고 있습니다…');
    try {
      const service=await getService();
      if(!alive(token)||dialog!==activeDialog)return;
      // Create a non-totalled draft before uploading. A failed upload remains retryable.
      if(cleanupPath){await service.cleanupOrphan(cleanupPath);if(!alive(token))return;cleanupPath=null;}
      if(!draft.id){creationInput ||= {...input,status:'draft',request_id:draft.request_id};draft=await service.save(creationInput);if(!alive(token))return;}
      while(pendingFiles.length) {
        const entry=pendingFiles[0];
        const updated=await service.addReceipt(draft.id,entry.file);
        if(!alive(token))return;
        draft=updated;pendingFiles.shift();renderFiles();
      }
      await service.save({...input,id:draft.id,request_id:saveOperation.requestId});
      if(!alive(token))return;
      setBusy(false);close();toast(status==='draft'?'작성 중으로 저장했습니다.':'지출을 저장했습니다.','success');await refresh();
    } catch(error) {if(alive(token)&&dialog===activeDialog){if(error.cleanupPath)cleanupPath=error.cleanupPath;report(`저장하지 못했습니다. ${error.message}${draft?.id?' 이미 보관된 파일은 유지됩니다.':''}`);}}
    finally {if(dialog===activeDialog)setBusy(false);}
  }
  async function onDialogClick(event) {
    const button=event.target.closest('button');if(!button||busy)return;
    if(button.hasAttribute('data-close'))return close();
    if(button.hasAttribute('data-camera'))return dialog.querySelector('[data-camera-input]').click();
    if(button.hasAttribute('data-upload'))return dialog.querySelector('[data-upload-input]').click();
    if(button.hasAttribute('data-remove-file')){pendingFiles.splice(Number(button.dataset.removeFile),1);return renderFiles();}
    if(button.hasAttribute('data-draft'))return save('draft');
    const token=generation,activeDialog=dialog;
    try {
      if(button.hasAttribute('data-preview')) {
        const receipt=draft.receipts[Number(button.dataset.preview)];
        // Obtain a private short-lived URL only in response to a user gesture.
        const service=await getService();const url=await service.receiptUrl(receipt);
        if(!alive(token)||dialog!==activeDialog)return;
        let area=dialog.querySelector('[data-receipt-view]');
        if(!area){area=document.createElement('div');area.dataset.receiptView='';area.className='expense-receipt-view';dialog.querySelector('[data-files]').after(area);}
        area.innerHTML='';
        if((receipt.mime_type||receipt.content_type||'').startsWith('image/')){const img=document.createElement('img');img.src=url;img.alt='첨부 영수증';area.append(img);}
        const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='원본 열기';area.append(link);return;
      }
      if(button.hasAttribute('data-trash')||button.hasAttribute('data-restore')) {
        if(button.hasAttribute('data-trash')&&!window.confirm('이 지출을 휴지통으로 옮길까요? 나중에 복원할 수 있습니다.'))return;
        setBusy(true);const service=await getService();if(!alive(token)||dialog!==activeDialog)return;const updated=await service.setStatus(draft.id,button.hasAttribute('data-trash')?'trashed':'restore');
        if(!alive(token))return;if(button.hasAttribute('data-restore'))filter=updated.status==='draft'?'draft':'all';setBusy(false);close();await refresh();return;
      }
      if(button.hasAttribute('data-adjust')) {
        const amount=Number(dialog.querySelector('[data-adjust-amount]').value),date=dialog.querySelector('[data-adjust-date]').value;
        if(!Number.isSafeInteger(amount)||amount<=0||!date){report('받은 날짜와 1원 이상의 금액을 입력해 주세요.');return;}
        const input={kind:dialog.querySelector('[data-adjust-kind]').value,amount,actual_date:date,memo:dialog.querySelector('[data-adjust-memo]').value,request_id:button.dataset.requestId||crypto.randomUUID()};button.dataset.requestId=input.request_id;
        setBusy(true);const service=await getService();if(!alive(token)||dialog!==activeDialog)return;const updated=await service.adjust(draft.id,input);
        if(!alive(token))return;
        draft.adjustments=updated.adjustments;
        rows=rows.map((row)=>row.id===updated.id?updated:row);render();
        dialog.querySelector('[data-adjustments]').innerHTML=draft.adjustments.map((a)=>`<p>${a.kind==='refund'?'환불':'비용 보전'} · ${esc(a.actual_date)} · ${money(a.amount)}원</p>`).join('');
        button.dataset.requestId='';dialog.querySelector('[data-adjust-amount]').value='';report('기록했습니다.');
      }
    } catch(error){if(alive(token)&&dialog===activeDialog)report(error.message);}
    finally {if(dialog===activeDialog)setBusy(false);}
  }
  host.addEventListener('click',(event)=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-new'))open();
    if(button.hasAttribute('data-inbox'))open(null,true);
    if(button.hasAttribute('data-retry'))refresh();
    if(button.hasAttribute('data-expense'))open(rows.find((r)=>r.id===button.dataset.expense));
    if(button.hasAttribute('data-month')){const [year,mm]=month.split('-').map(Number);const d=new Date(year,mm-1+Number(button.dataset.month),1);month=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;refresh();}
  });
  host.addEventListener('change',(event)=>{
    if(event.target.matches('[data-month-input]')&&/^\d{4}-\d{2}$/.test(event.target.value)){month=event.target.value;refresh();}
    if(event.target.matches('[data-filter]')){filter=event.target.value;render();}
  });
  return {refresh,open,handleBack:()=>dialog?close():false,reset(){generation++;rows=[];close(true);host.innerHTML='';},dispose(){disposed=true;generation++;close(true);host.innerHTML='';}};
}
