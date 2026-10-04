import { addDays, dateKeysBetween, normalizeDateKey } from './stats-report.js';

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = value => `${Math.round(finite(value)).toLocaleString('ko-KR')}원`;
const man = value => (finite(value) / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const shortDate = key => `${Number(key.slice(5, 7))}.${Number(key.slice(8, 10))}`;
const longDate = key => `${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일`;
const weekday = key => ['일', '월', '화', '수', '목', '금', '토'][new Date(`${key}T00:00:00Z`).getUTCDay()];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let chartInstance = 0;

/** Round financial axes to familiar intervals, e.g. 0 / 200만 / 400만 / 600만. */
export function buildNotebookChartScale({ min = 0, max = 1 } = {}) {
  const low = Math.min(0, finite(min));
  const high = Math.max(1, finite(max));
  const interval = (high - low) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(interval));
  const step = ([1, 2, 2.5, 5, 10].find(value => value * magnitude >= interval) || 10) * magnitude;
  const bottom = Math.floor(low / step) * step;
  const top = Math.ceil(high / step) * step;
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, index) => bottom + step * index);
  return { min: bottom, max: top, step, ticks };
}

/** View-only dates/amounts. No price lookup, persistence, account or timing reads. */
export function buildNotebookChartModel({ report, days = [], asOfDate, windowEnd, selectedDate } = {}) {
  const start = normalizeDateKey(report?.range?.start);
  const rangeEnd = normalizeDateKey(report?.range?.end);
  const asOf = normalizeDateKey(asOfDate);
  if (!start || !rangeEnd || !asOf || start > rangeEnd) throw new RangeError('정산 그래프 조회 기간이 올바르지 않습니다.');
  const cutoff = rangeEnd < asOf ? rangeEnd : asOf;
  const axisEnd = report.mode === 'thisSettlement' && normalizeDateKey(report.period?.end)
    ? report.period.end : rangeEnd;
  const byDate = new Map();
  // Contract is one canonical row per date, as returned by statsDailyRecords().
  for (const day of days) {
    const key = normalizeDateKey(day?.dateKey);
    if (key) byDate.set(key, day);
  }
  const rows = dateKeysBetween(start, cutoff).map(dateKey => {
    const source = byDate.get(dateKey);
    return {
      dateKey,
      status: source?.off === true ? 'off' : source?.worked === true ? 'work' : 'missing',
      revenue: finite(source?.revenue),
      count: finite(source?.count),
      source: source || null,
    };
  });
  let cumulative = 0;
  const cumulativePoints = rows.map(row => ({ dateKey: row.dateKey, revenue: cumulative += row.revenue }));
  const points = rows.some(row => row.status === 'work' || row.revenue !== 0) ? cumulativePoints : [];
  const requestedEnd = normalizeDateKey(windowEnd) || cutoff;
  const end = requestedEnd < start ? start : requestedEnd > cutoff ? cutoff : requestedEnd;
  const first = addDays(end, -7);
  const windowStart = first < start ? start : first;
  const windowDays = rows.filter(row => row.dateKey >= windowStart && row.dateKey <= end);
  const worked = windowDays.filter(row => row.status === 'work');
  const bestDay = worked.reduce((best, row) => !best || row.revenue > best.revenue ? row : best, null);
  const averageRevenue = worked.length ? worked.reduce((total, row) => total + row.revenue, 0) / worked.length : null;
  const chosen = windowDays.find(row => row.dateKey === selectedDate) || bestDay || windowDays.at(-1) || null;
  const target = report.mode === 'thisSettlement' && report.goal?.applicable !== false && finite(report.goal?.target) > 0 ? finite(report.goal.target) : null;
  const cumulativeValues = [0, ...points.map(point => point.revenue)];
  return {
    range: { start, end: axisEnd }, cutoff, rows, points, totalRevenue: cumulative,
    target, goalApplicable: target !== null && report.goal?.applicable !== false,
    maxRevenue: Math.max(target || 0, ...cumulativeValues, 1),
    minRevenue: Math.min(...cumulativeValues),
    windowStart, windowEnd: end, windowDays, bestDay, averageRevenue,
    selectedDate: chosen?.dateKey || null, selectedDay: chosen,
    hasPrevious: windowDays.length > 0 && windowStart > start,
    hasNext: windowDays.length > 0 && end < cutoff,
    dailyMaximum: Math.max(200000, Math.ceil(Math.max(0, ...worked.map(row => row.revenue)) / 100000) * 100000),
    dailyMinimum: Math.min(0, ...worked.map(row => row.revenue)),
  };
}

/** Receives canonical, historically priced route aggregates from the app. */
export function buildNotebookDayDetail(day, detail = {}) {
  return {
    dateKey: day?.dateKey || null,
    status: day?.status || 'missing',
    revenue: finite(day?.revenue),
    routes: (Array.isArray(detail.routes) ? detail.routes : []).map(row => ({
      route: String(row.route ?? ''), count: finite(row.count), revenue: finite(row.revenue),
    })),
    deliveryRevenue: finite(detail.deliveryRevenue ?? day?.source?.deliveryRevenue),
    freshRevenue: finite(detail.freshRevenue ?? day?.source?.freshRevenue),
    backupRevenue: finite(detail.backupRevenue ?? day?.source?.backupRevenue),
    returnCount: finite(detail.returnCount ?? day?.source?.returnCount),
  };
}

/** Roots are owned by this view; the parent keeps all existing stats renderers. */
export function createStatsNotebookCharts({ goalRoot, dailyRoot, whenVisible, shouldAnimate = () => false, getDayDetail = () => ({}) } = {}) {
  let inputs, model, rangeKey = '', end = null, chosen = null;
  let goalRevision = 0, dailyRevision = 0;
  let goalPlayedFingerprint = '', dailyPlayedFingerprint = '';
  const gradientId = `stats-notebook-area-${++chartInstance}`;
  const activeAnimations = new Set();
  const schedule = (root, key, callback) => {
    if (whenVisible) whenVisible(root, key, callback);
    else callback();
  };
  function cancelAnimations() {
    for (const animation of activeAnimations) animation.cancel();
    activeAnimations.clear();
  }
  function play(node, frames, options) {
    if (!shouldAnimate() || typeof node.animate !== 'function') return;
    const animation = node.animate(frames, options);
    activeAnimations.add(animation);
    animation.finished?.then(() => activeAnimations.delete(animation), () => activeAnimations.delete(animation));
  }
  function render(nextInputs) {
    cancelAnimations();
    inputs = nextInputs;
    const key = `${inputs.report.mode}:${inputs.report.range.start}:${inputs.report.period?.id || ''}`;
    if (key !== rangeKey) { end = null; chosen = null; rangeKey = key; }
    if (model?.windowEnd === model?.cutoff) end = null;
    model = buildNotebookChartModel({ ...inputs, windowEnd: end, selectedDate: chosen });
    end = model.windowEnd; chosen = model.selectedDate;
    renderGoal(); renderDaily();
    return model;
  }
  function renderGoal() {
    if (!goalRoot) return;
    goalRoot.classList.add('stats-notebook-goal');
    const currentFingerprint = JSON.stringify([model.range, model.cutoff, model.points, model.target]);
    const shouldReplay = currentFingerprint !== goalPlayedFingerprint;
    const token = ++goalRevision;
    const svgWidth = Math.max(280, goalRoot.clientWidth || 390), height = 225;
    const box = { left: 46, right: svgWidth - 13, top: 22, bottom: height - 31 };
    const stamp = key => Date.parse(`${key}T00:00:00Z`);
    const daySpan = Math.max(86400000, stamp(model.range.end) - stamp(model.range.start));
    const x = key => box.left + (stamp(key) - stamp(model.range.start)) / daySpan * (box.right - box.left);
    const scale = buildNotebookChartScale({ min: model.minRevenue, max: model.maxRevenue });
    const { max, min } = scale;
    const y = amount => box.bottom - (amount - min) / (max - min) * (box.bottom - box.top);
    const points = [{ dateKey: model.range.start, revenue: 0 }, ...model.points];
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.dateKey).toFixed(2)} ${y(point.revenue).toFixed(2)}`).join(' ');
    const tip = points.at(-1);
    const area = `${path} L${x(tip.dateKey).toFixed(2)} ${y(0).toFixed(2)} L${x(model.range.start).toFixed(2)} ${y(0).toFixed(2)} Z`;
    const axis = scale.ticks.map(value => {
      const label = value === 0 ? '0' : Math.abs(value) >= 100000000 ? `${(value / 100000000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억` : `${man(value)}만`;
      return `<line x1="${box.left}" x2="${box.right}" y1="${y(value)}" y2="${y(value)}" class="snb-grid"/><text x="${box.left - 8}" y="${y(value) + 3}" text-anchor="end">${label}</text>`;
    }).join('');
    const middle = addDays(model.range.start, Math.floor(daySpan / 86400000 / 2));
    const ticks = [...new Set([model.range.start, middle, model.range.end])].filter(key => key >= model.range.start && key <= model.range.end);
    const labels = ticks.map((key, index) => `<text x="${x(key)}" y="${height - 10}" text-anchor="${index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}">${shortDate(key)}</text>`).join('');
    const tipX = x(tip.dateKey), tipY = y(tip.revenue);
    const textX = Math.max(box.left + 30, Math.min(box.right - 30, tipX));
    const summary = `${shortDate(model.range.start)}부터 ${shortDate(model.range.end)}까지 누적 매출. ${shortDate(model.cutoff)}까지 기록된 매출 ${money(model.totalRevenue)}.${model.target ? ` 목표 ${money(model.target)}.` : ' 목표 미설정.'} 미래 매출은 그리지 않습니다.`;
    goalRoot.innerHTML = `<div class="snb-key"><span class="snb-actual-key">실제 누적</span>${model.target ? '<span class="snb-reference-key">목표 참고선</span>' : ''}</div><svg class="snb-goal-chart" viewBox="0 0 ${svgWidth} ${height}" role="img" aria-label="${escape(summary)}"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop class="snb-area-stop" offset="0" stop-opacity=".2"/><stop class="snb-area-stop" offset="1" stop-opacity=".015"/></linearGradient></defs>${axis}${model.goalApplicable ? `<path class="snb-goal-reference" d="M${x(model.range.start)} ${y(0)} L${x(model.range.end)} ${y(model.target)}"/>` : ''}${model.points.length ? `<path class="snb-goal-area" fill="url(#${gradientId})" d="${area}"/><path class="snb-goal-line" d="${path}"/><circle class="snb-goal-tip" cx="${tipX}" cy="${tipY}" r="4"/><text class="snb-goal-value" x="${textX}" y="${Math.max(12, tipY - 12)}" text-anchor="middle">${man(model.totalRevenue)}만</text>` : ''}${labels}</svg><p class="snb-note">${model.points.length ? `실매출은 ${shortDate(model.cutoff)}까지 표시해요.` : '이 기간에 기록된 매출이 없어요.'}${model.target ? ' 목표 참고선에는 휴무를 반영하지 않았어요.' : ''}</p>`;
    if (!shouldReplay || !model.points.length) return;
    schedule(goalRoot, 'notebook-goal', () => {
      if (token !== goalRevision) return;
      goalPlayedFingerprint = currentFingerprint;
      const line = goalRoot.querySelector('.snb-goal-line');
      const areaNode = goalRoot.querySelector('.snb-goal-area');
      const tipNode = goalRoot.querySelector('.snb-goal-tip');
      const valueNode = goalRoot.querySelector('.snb-goal-value');
      if (!line || !shouldAnimate()) return;
      let length;
      try { length = line.getTotalLength(); } catch (_) { return; }
      play(line, [{ strokeDasharray: `${length} ${length}`, strokeDashoffset: length }, { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 }], { duration: 850, easing: 'cubic-bezier(.2,.7,.3,1)' });
      for (const node of [areaNode, tipNode, valueNode]) if (node) play(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 500, fill: 'backwards' });
    });
  }
  function renderDaily() {
    if (!dailyRoot) return;
    const token = ++dailyRevision;
    dailyRoot.classList.add('stats-notebook-daily');
    const totalSpan = model.dailyMaximum - model.dailyMinimum;
    const baseline = model.dailyMaximum / totalSpan * 100;
    const averageTop = model.averageRevenue === null ? 0 : (model.dailyMaximum - model.averageRevenue) / totalSpan * 100;
    const insight = model.bestDay ? `<p>${longDate(model.bestDay.dateKey)}에 가장 많이 벌었어요</p><strong>${man(model.bestDay.revenue)}<small>만원</small></strong><span>근무일 평균 ${man(model.averageRevenue)}만원보다 ${man(model.bestDay.revenue - model.averageRevenue)}만원 높아요</span>` : '<p>이 기간에는 근무 기록이 없어요</p><span>이전 날짜의 기록을 확인해 보세요.</span>';
    dailyRoot.innerHTML = `<div class="stats-report-section-head"><div><span>하루 매출</span><h2>날짜별로 매출을 확인해요</h2></div></div><div class="snb-daily-insight">${insight}</div>${model.windowDays.length ? `<p class="snb-daily-range">${shortDate(model.windowStart)} ~ ${shortDate(model.windowEnd)} · 날짜를 눌러 보세요</p><div class="snb-daily-chart"><div class="snb-daily-axis" aria-hidden="true"><span>${man(model.dailyMaximum)}만원</span><span>${man((model.dailyMaximum + model.dailyMinimum) / 2)}만원</span><span>${model.dailyMinimum ? `${man(model.dailyMinimum)}만원` : '0'}</span></div><div class="snb-daily-plot"><div class="snb-plot-grid" aria-hidden="true"></div>${model.averageRevenue !== null ? `<div class="snb-average-line" style="top:${averageTop}%" aria-hidden="true"><span>평균 ${man(model.averageRevenue)}만</span></div>` : ''}<div class="snb-day-bars" style="--snb-columns:${model.windowDays.length}">${model.windowDays.map(row => {
      const height = Math.abs(row.revenue) / totalSpan * 100;
      const top = row.revenue >= 0 ? baseline - height : baseline;
      const aria = `${longDate(row.dateKey)} ${weekday(row.dateKey)}요일 ${row.status === 'work' ? money(row.revenue) : row.status === 'off' ? '휴무' : '미기록'}`;
      const visual = row.status === 'work' ? `<i class="snb-bar-fill${row.revenue < 0 ? ' is-negative' : ''}" style="height:${height}%;top:${top}%"></i><b class="snb-bar-value" style="top:${Math.max(0, top - 10)}%">${man(row.revenue)}</b>` : row.status === 'off' ? '<span class="snb-off-label">휴무</span>' : '<i class="snb-missing-mark"></i><b class="snb-missing-label">미기록</b>';
      return `<button type="button" class="snb-day-bar" data-notebook-date="${row.dateKey}" aria-pressed="${row.dateKey === model.selectedDate}" aria-label="${escape(aria)}"><span class="snb-bar-region">${visual}</span><span class="snb-day-label">${shortDate(row.dateKey)}<small>${weekday(row.dateKey)}</small></span></button>`;
    }).join('')}</div></div></div><div class="snb-day-controls"><button type="button" data-notebook-window="-1"${model.hasPrevious ? '' : ' disabled'} aria-label="이전 8일 보기">‹ 이전 날짜</button><p>휴무·미기록은 평균에서 제외</p><button type="button" data-notebook-window="1"${model.hasNext ? '' : ' disabled'} aria-label="다음 8일 보기">다음 날짜 ›</button></div><div class="snb-day-detail" aria-live="polite"></div>` : '<p class="snb-note">조회할 날짜가 아직 오지 않았어요.</p>'}`;
    renderDetail();
    const fingerprint = JSON.stringify(model.windowDays.map(row => [row.dateKey, row.revenue, row.status]));
    const shouldReplay = fingerprint !== dailyPlayedFingerprint;
    if (!shouldReplay) return;
    schedule(dailyRoot, 'notebook-daily-bars', () => {
      if (token !== dailyRevision) return;
      dailyPlayedFingerprint = fingerprint;
      dailyRoot.querySelectorAll('.snb-bar-fill').forEach((fill, index) => play(fill, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 550, delay: index * 35, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' }));
    });
  }
  function renderDetail() {
    const node = dailyRoot?.querySelector('.snb-day-detail');
    if (!node || !model.selectedDay) return;
    const detail = buildNotebookDayDetail(model.selectedDay, getDayDetail(model.selectedDate));
    dailyRoot.querySelectorAll('[data-notebook-date]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.notebookDate === model.selectedDate)));
    if (detail.status !== 'work') {
      node.innerHTML = `<h3>${longDate(detail.dateKey)} · ${detail.status === 'off' ? '휴무' : '미기록'}</h3><p>${detail.status === 'off' ? '쉬는 날이에요. 근무일 평균에 넣지 않아요.' : '아직 매출 실적이 없어요. 0원 근무로 계산하지 않아요.'}</p>`;
      return;
    }
    node.innerHTML = `<h3>${longDate(detail.dateKey)} · 구역별 배송 매출</h3>${detail.routes.map(row => `<div class="snb-route-row"><span>${escape(row.route)}<small>${row.count.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}개</small></span><strong>${money(row.revenue)}</strong></div>`).join('') || '<p>구역별로 나눌 수 있는 배송 매출이 없어요.</p>'}${detail.freshRevenue ? `<div class="snb-route-row"><span>프레시백</span><strong>${money(detail.freshRevenue)}</strong></div>` : ''}${detail.backupRevenue ? `<div class="snb-route-row"><span>백업수당</span><strong>${money(detail.backupRevenue)}</strong></div>` : ''}${detail.returnCount ? `<p class="snb-note">반품 ${detail.returnCount.toLocaleString('ko-KR')}개 포함</p>` : ''}<div class="snb-route-total"><span>총 매출</span><strong>${money(detail.revenue)}</strong></div><p class="snb-note">구역은 저장된 당시 단가로 계산한 배송 매출이에요. 묶음 구역은 균등 배분한 참고값이에요.</p>`;
  }
  function moveWindow(direction) {
    const candidate = addDays(model.windowEnd, direction * 8);
    end = candidate < model.range.start ? model.range.start : candidate > model.cutoff ? model.cutoff : candidate;
    model = buildNotebookChartModel({ ...inputs, windowEnd: end, selectedDate: chosen });
    end = model.windowEnd; chosen = model.selectedDate;
    renderDaily();
  }
  function selectDate(key) {
    chosen = key;
    model = buildNotebookChartModel({ ...inputs, windowEnd: end, selectedDate: chosen });
    renderDetail();
  }
  function click(event) {
    const button = event.target.closest?.('button');
    if (!button || !dailyRoot.contains(button) || button.disabled) return;
    if (button.dataset.notebookWindow) {
      const direction = button.dataset.notebookWindow;
      moveWindow(Number(direction));
      const nextControl = dailyRoot.querySelector(`[data-notebook-window="${direction}"]`);
      const focusTarget = nextControl && !nextControl.disabled ? nextControl
        : dailyRoot.querySelector('[data-notebook-window]:not(:disabled)') || dailyRoot.querySelector('[data-notebook-date]');
      focusTarget?.focus();
    }
    else if (button.dataset.notebookDate) selectDate(button.dataset.notebookDate);
  }
  function keydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...dailyRoot.querySelectorAll('[data-notebook-date]')];
    const current = buttons.indexOf(event.target);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
    buttons[next].focus(); selectDate(buttons[next].dataset.notebookDate);
  }
  function settle() { cancelAnimations(); }
  function destroy() { goalRevision += 1; dailyRevision += 1; cancelAnimations(); dailyRoot?.removeEventListener('click', click); dailyRoot?.removeEventListener('keydown', keydown); }
  dailyRoot?.addEventListener('click', click);
  dailyRoot?.addEventListener('keydown', keydown);
  return { render, settle, destroy };
}
