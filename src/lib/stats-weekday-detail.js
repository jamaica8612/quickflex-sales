const LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const format = (value) => number(value).toLocaleString("ko-KR");

function weekdayFor(dateKey) {
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return -1;
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return -1;
  return date.getUTCDay();
}

// Only canonical day totals enter this view; route snapshots and raw records
// never pass through it. A worked day with zero sales remains a worked day.
export function buildWeekdayRecords(days, index) {
  if (!Number.isInteger(index) || index < 0 || index > 6) return [];
  return (Array.isArray(days) ? days : [])
    .filter((day) => day && weekdayFor(day.dateKey) === index)
    .map((day) => ({
      dateKey: day.dateKey,
      revenue: number(day.revenue),
      count: number(day.count),
      freshCount: number(day.freshCount),
      returnCount: number(day.returnCount),
      worked: day.worked === true,
      off: day.off === true,
    }))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

export function createStatsWeekdayDetail({ root, recordsRoot }) {
  let days = [];
  let selected = null;
  let bindings = [];
  let disclosureOpen = false;

  function unbind() {
    bindings.forEach(({ col, click, keydown }) => {
      col.removeEventListener("click", click);
      col.removeEventListener("keydown", keydown);
    });
    bindings = [];
  }

  function drawRecords() {
    if (!recordsRoot || selected === null) return;
    const records = buildWeekdayRecords(days, selected);
    const worked = records.filter((day) => day.worked && !day.off);
    const oldDisclosure = recordsRoot.querySelector("details");
    if (oldDisclosure) disclosureOpen = oldDisclosure.open;
    const empty = !worked.length ? '<p class="weekday-record-empty">선택한 기간에 이 요일의 근무 기록이 없습니다.</p>' : "";
    const rows = records.map((day) => {
      const [, month, date] = day.dateKey.split("-").map(Number);
      const status = day.off ? "휴무" : day.worked ? `${format(day.count)}개` : "근무 미확인";
      return `<li class="weekday-record-row"><div><time datetime="${escapeHtml(day.dateKey)}">${month}월 ${date}일 (${LABELS[selected]})</time><span>${escapeHtml(status)}</span></div><strong>${escapeHtml(format(day.revenue))}<small>원</small></strong></li>`;
    }).join("");
    recordsRoot.innerHTML = `<details class="weekday-record-details"${disclosureOpen ? " open" : ""}><summary>${LABELS[selected]}요일 · ${worked.length}일 근무 기록 보기</summary>${empty}${rows ? `<ul class="weekday-record-list">${rows}</ul>` : ""}</details>`;
  }

  function markSelection() {
    bindings.forEach(({ col, index }) => {
      const active = index === selected;
      col.classList.toggle("is-selected", active);
      col.setAttribute("aria-pressed", String(active));
    });
  }

  function select(index, open = true) {
    selected = index;
    if (open) {
      const details = recordsRoot?.querySelector("details");
      if (details) details.open = true;
      disclosureOpen = true;
    }
    markSelection();
    drawRecords();
  }

  function render({ days: nextDays } = {}) {
    days = Array.isArray(nextDays) ? nextDays : [];
    unbind();
    const cols = Array.from(root?.querySelectorAll(".wd-col") || []);
    if (!cols.length) {
      if (recordsRoot) recordsRoot.innerHTML = "";
      return;
    }
    if (selected === null) {
      const preferred = cols.find((col) => col.classList.contains("is-best"));
      selected = preferred ? Number(preferred.dataset.weekday) : new Date().getDay();
    }
    cols.forEach((col) => {
      const index = Number(col.dataset.weekday);
      if (!Number.isInteger(index) || index < 0 || index > 6) return;
      col.setAttribute("role", "button");
      col.setAttribute("tabindex", "0");
      const count = buildWeekdayRecords(days, index).filter((day) => day.worked && !day.off).length;
      const average = col.querySelector(".wd-avg")?.textContent || "-";
      col.setAttribute("aria-label", `${LABELS[index]}요일, 근무 ${count}일, 근무일당 매출 ${average}, 날짜별 기록 보기`);
      const click = () => select(index);
      const keydown = (event) => {
        if (["Enter", " ", "Spacebar"].includes(event.key)) {
          event.preventDefault();
          select(index);
          return;
        }
        const position = bindings.findIndex((binding) => binding.col === col);
        const target = event.key === "ArrowRight" ? (position + 1) % bindings.length
          : event.key === "ArrowLeft" ? (position + bindings.length - 1) % bindings.length
            : event.key === "Home" ? 0 : event.key === "End" ? bindings.length - 1 : -1;
        if (target < 0) return;
        event.preventDefault();
        bindings[target].col.focus();
        select(bindings[target].index);
      };
      col.addEventListener("click", click);
      col.addEventListener("keydown", keydown);
      bindings.push({ col, index, click, keydown });
    });
    markSelection();
    drawRecords();
  }

  function destroy() {
    bindings.forEach(({ col }) => {
      ["role", "tabindex", "aria-pressed", "aria-label"].forEach((name) => col.removeAttribute(name));
      col.classList.remove("is-selected");
    });
    unbind();
    if (recordsRoot) recordsRoot.innerHTML = "";
    days = [];
    selected = null;
  }
  return { render, destroy };
}
