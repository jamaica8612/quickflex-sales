const DATA_URL = new URL("../../assets/data/agricultural-market-route-map-cells.json", import.meta.url).href;
const ANNEX_DATA_URL = new URL("../../assets/data/agricultural-market-annexes.json", import.meta.url).href;
const ZONE_NAME = "311CD322D";
const TIP_ID = "agricultural-market-route-map";
const DEFAULT_POSITION = Object.freeze({ lat: 35.213697087961, lng: 129.12207612148 });
const COLUMN_WIDTH = 31;
const ROW_HEIGHT = 21;
const MIN_SCALE = 0.55;
const MAX_SCALE = 2;
const BUILDINGS = Object.freeze([
  { id: "cheonggwamul", label: "청과물동" },
  { id: "mubaechu", label: "무배추동" },
  { id: "yangnyeom", label: "양념동" },
]);
const SECTION_TABS = Object.freeze([
  { id: "all", label: "전체", cellId: "2:10" },
  { id: "east", label: "동부청과", cellId: "2:10" },
  { id: "central", label: "중앙청과", cellId: "2:29" },
  { id: "nh", label: "농협공판장", cellId: "2:48" },
]);
const ALLOWED_CELL_STYLES = new Set([
  "background", "border-bottom", "border-left", "border-right", "border-top",
  "color", "font-size", "text-align", "vertical-align",
]);

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLocaleLowerCase();
}

function element(documentRef, tag, attributes = {}, children = []) {
  const target = documentRef.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (name === "class") target.className = value;
    else if (name === "text") target.textContent = value;
    else if (name.startsWith("on")) target.addEventListener(name.slice(2).toLowerCase(), value);
    else target.setAttribute(name, String(value));
  }
  children.flat().filter(Boolean).forEach((child) => target.append(child));
  return target;
}

function icon(documentRef, name) {
  const svg = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
  const paths = name === "close"
    ? ["M6.5 6.5 17.5 17.5", "M17.5 6.5 6.5 17.5"]
    : name === "minus" ? ["M5 12h14"] : ["M12 5v14", "M5 12h14"];
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "market-route-map-icon");
  paths.forEach((data) => {
    const path = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  });
  return svg;
}

function iconButton(documentRef, name, label, action) {
  return element(documentRef, "button", {
    type: "button", class: "market-route-map-icon-button", "aria-label": label, title: label, onClick: action,
  }, [icon(documentRef, name)]);
}

function applyCellStyle(target, styleText) {
  String(styleText || "").split(";").forEach((rule) => {
    const colon = rule.indexOf(":");
    if (colon < 1) return;
    const property = rule.slice(0, colon).trim();
    const value = rule.slice(colon + 1).trim();
    if (ALLOWED_CELL_STYLES.has(property) && value) target.style.setProperty(property, value);
  });
}

function annexDisplay(cell) {
  return cell.vendorName || cell.stallNumber || cell.sectionName || cell.notes || "";
}

function annexSearchText(cell) {
  return [cell.vendorName, cell.stallNumber, cell.sectionName, cell.companyName, cell.notes].filter(Boolean).join(" ");
}

export function isAgriculturalMarketZone(zone) {
  return Boolean(zone && !zone.is_deleted && normalize(zone.name).includes(normalize(ZONE_NAME)));
}

export function isAgriculturalMarketTip(tip) {
  return Boolean(tip && (tip.id === TIP_ID || tip.is_agricultural_market_route_map));
}

export function buildAgriculturalMarketTip(zone) {
  return {
    id: TIP_ID,
    zone_id: zone?.id || null,
    title: "농산물시장 라우트 지도",
    memo: "반여농산물시장 청과물동·무배추동·양념동 점포 위치와 배송 동선을 한눈에 확인하세요.",
    marker_type: "market_map",
    lat: DEFAULT_POSITION.lat,
    lng: DEFAULT_POSITION.lng,
    author_name: "구역노트",
    is_deleted: false,
    is_agricultural_market_route_map: true,
    photos: [],
  };
}

export function appendAgriculturalMarketTip(detail) {
  if (!isAgriculturalMarketZone(detail?.zone)) return detail;
  const tips = Array.isArray(detail?.tips) ? detail.tips : [];
  if (tips.some(isAgriculturalMarketTip)) return { ...detail, tips };
  return { ...detail, tips: [buildAgriculturalMarketTip(detail.zone), ...tips] };
}

export function openAgriculturalMarketRouteMap({ documentRef = document, windowRef = window, onClose } = {}) {
  const previousFocus = documentRef.activeElement;
  const previousOverflow = documentRef.body.style.overflow;
  const abort = new AbortController();
  let closed = false;
  let scale = 1;
  let query = "";
  let activeBuilding = "cheonggwamul";
  let datasets = null;
  let cells = [];
  let cellElements = new Map();
  let activeCanvas = null;
  let baseWidth = 1;
  let baseHeight = 1;

  const overlay = element(documentRef, "section", {
    class: "market-route-map-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "marketRouteMapTitle",
  });
  const title = element(documentRef, "strong", { id: "marketRouteMapTitle", class: "market-route-map-title", text: "청과물동" });
  const subtitle = element(documentRef, "span", { class: "market-route-map-subtitle", text: "311CD322D · 반여농산물시장" });
  const closeButton = iconButton(documentRef, "close", "농산물시장 지도 닫기", close);
  const header = element(documentRef, "header", { class: "market-route-map-header" }, [
    element(documentRef, "div", { class: "market-route-map-heading" }, [title, subtitle]), closeButton,
  ]);
  const search = element(documentRef, "input", {
    type: "search", class: "market-route-map-search", placeholder: "점포명·호수 검색", "aria-label": "농산물시장 점포명 또는 호수 검색", autocomplete: "off",
  });
  const count = element(documentRef, "span", { class: "market-route-map-count", "aria-live": "polite" });
  const zoomValue = element(documentRef, "span", { class: "market-route-map-zoom-value", text: "100%" });
  const scroller = element(documentRef, "div", { class: "market-route-map-scroller", tabindex: "0", "aria-label": "농산물시장 점포 배치도" });
  const stage = element(documentRef, "div", { class: "market-route-map-stage" });
  const state = element(documentRef, "p", { class: "market-route-map-state", text: "농산물시장 지도를 불러오는 중입니다." });
  const buildingTabs = element(documentRef, "nav", { class: "market-route-map-building-tabs", "aria-label": "농산물시장 건물 선택" });
  const sectionTabs = element(documentRef, "nav", { class: "market-route-map-tabs", "aria-label": "청과물동 구역 바로가기" });

  function close() {
    if (closed) return;
    closed = true;
    abort.abort();
    overlay.remove();
    documentRef.body.style.overflow = previousOverflow;
    previousFocus?.focus?.({ preventScroll: true });
    onClose?.();
  }

  function adjustScale(amount, reset = false) {
    scale = reset ? 1 : Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((scale + amount).toFixed(2))));
    stage.style.width = `${baseWidth * scale}px`;
    stage.style.height = `${baseHeight * scale}px`;
    if (activeCanvas) activeCanvas.style.transform = `scale(${scale})`;
    zoomValue.textContent = `${Math.round(scale * 100)}%`;
  }

  function updateMatches(scrollToFirst = true) {
    const needle = normalize(query);
    let matches = 0;
    let first = null;
    cells.forEach((cell) => {
      const target = cellElements.get(cell.cellId);
      const searchText = cell.searchText ?? cell.value;
      const matched = Boolean(needle && normalize(searchText).includes(needle));
      target?.classList.toggle("is-match", matched);
      if (matched) { matches += 1; first ||= target; }
    });
    count.textContent = needle ? `${matches}개` : "";
    if (scrollToFirst) first?.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "center" });
  }

  function mountCanvas(canvas, width, height) {
    activeCanvas = canvas;
    baseWidth = width;
    baseHeight = height;
    stage.replaceChildren(canvas);
    scroller.replaceChildren(stage);
    adjustScale(0, true);
    state.hidden = true;
    updateMatches(false);
  }

  function renderMain(data) {
    cells = Array.isArray(data?.cells) ? data.cells : [];
    const region = data?.region || { rowStart: 2, rowEnd: 36, colStart: 10, colEnd: 68 };
    const rows = new Map();
    cells.forEach((cell) => {
      if (!rows.has(cell.row)) rows.set(cell.row, []);
      rows.get(cell.row).push(cell);
    });
    const table = element(documentRef, "table", { class: "market-route-map-table", "aria-label": "청과물동 점포 배치" });
    const colgroup = element(documentRef, "colgroup");
    for (let col = region.colStart; col <= region.colEnd; col += 1) {
      const column = element(documentRef, "col");
      column.style.width = `${COLUMN_WIDTH}px`;
      colgroup.append(column);
    }
    const body = element(documentRef, "tbody");
    cellElements = new Map();
    for (let row = region.rowStart; row <= region.rowEnd; row += 1) {
      const tr = element(documentRef, "tr");
      tr.style.height = `${ROW_HEIGHT}px`;
      (rows.get(row) || []).sort((a, b) => a.col - b.col).forEach((cell) => {
        const td = element(documentRef, "td", { text: cell.value || "" });
        if (cell.rowspan > 1) td.rowSpan = cell.rowspan;
        if (cell.colspan > 1) td.colSpan = cell.colspan;
        applyCellStyle(td, cell.style);
        if (!cell.value) td.classList.add("is-empty");
        cellElements.set(cell.cellId, td);
        tr.append(td);
      });
      body.append(tr);
    }
    table.replaceChildren(colgroup, body);
    mountCanvas(table, (region.colEnd - region.colStart + 1) * COLUMN_WIDTH, (region.rowEnd - region.rowStart + 1) * ROW_HEIGHT);
  }

  function createAnnexCell(cell, className = "") {
    const target = element(documentRef, "div", {
      class: `market-route-map-annex-cell is-${cell.cellType || "stall"}${className ? ` ${className}` : ""}`,
      title: annexSearchText(cell),
    });
    const name = annexDisplay(cell);
    if (name) target.append(element(documentRef, "span", { class: "market-route-map-annex-name", text: name }));
    if (cell.vendorName && cell.stallNumber) target.append(element(documentRef, "small", { text: `${cell.stallNumber}호` }));
    cellElements.set(cell.cellId, target);
    return target;
  }

  function renderMubaechu(data) {
    const dataCells = data?.cells || [];
    cells = dataCells.map((cell) => ({ ...cell, searchText: annexSearchText(cell) }));
    cellElements = new Map();
    const label = dataCells.find((cell) => cell.cellType === "label");
    const cols = [...new Set(dataCells.filter((cell) => cell.cellType !== "label").map((cell) => cell.col))].sort((a, b) => a - b);
    const rows = [...new Set(dataCells.filter((cell) => cell.cellType !== "label").map((cell) => cell.row))].sort((a, b) => a - b);
    const lookup = new Map(dataCells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
    const wrapper = element(documentRef, "div", { class: "market-route-map-mubaechu", role: "table", "aria-label": "무배추동 점포 배치" });
    wrapper.append(element(documentRef, "div", { class: "market-route-map-mubaechu-title", text: label?.vendorName || "무배추동" }));
    const grid = element(documentRef, "div", { class: "market-route-map-mubaechu-grid" });
    grid.style.gridTemplateColumns = `repeat(${cols.length}, 88px)`;
    rows.forEach((row) => {
      const walkway = dataCells.find((cell) => cell.row === row && cell.cellType === "walkway");
      if (walkway) {
        const target = createAnnexCell(walkway, "is-wide");
        target.style.gridColumn = `1 / span ${cols.length}`;
        grid.append(target);
        return;
      }
      cols.forEach((col) => {
        const cell = lookup.get(`${row}:${col}`);
        if (cell) grid.append(createAnnexCell(cell));
        else grid.append(element(documentRef, "div", { class: "market-route-map-annex-cell is-empty", "aria-hidden": "true" }));
      });
    });
    wrapper.append(grid);
    mountCanvas(wrapper, cols.length * 88, 64 + rows.length * 40);
  }

  function positionYangnyeomCell(cell, col, top, width, height, className = "") {
    const target = createAnnexCell(cell, className);
    target.style.left = `${14 + col * 57.6}px`;
    target.style.top = `${top}px`;
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    return target;
  }

  function renderYangnyeom(data) {
    const dataCells = data?.cells || [];
    cells = dataCells.map((cell) => ({ ...cell, searchText: annexSearchText(cell) }));
    cellElements = new Map();
    const lookup = new Map(dataCells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
    const canvas = element(documentRef, "div", { class: "market-route-map-yangnyeom", role: "img", "aria-label": "양념동 점포와 시설 배치" });
    const add = (row, col, visualCol, top, width = 57.6, height = 70, className = "") => {
      const cell = lookup.get(`${row}:${col}`);
      if (cell) canvas.append(positionYangnyeomCell(cell, visualCol, top, width, height, className));
    };
    add(1, 9, 1, 82, 69, 36, "is-facility");
    add(1, 10, 3.5, 70, 144, 64, "is-facility");
    [0, 1, 2, 3, 4, 5, 6, 7].forEach((col) => add(0, col, 8 + col, 70));
    add(0, 8, 16, 70, 115.2);
    add(0, 10, 18, 70);
    add(0, 11, 19, 70);
    add(1, 0, 8, 152, 69, 22, "is-label");
    add(2, 0, 8, 178, 57.6, 42, "is-facility");
    add(3, 0, 8, 224, 57.6, 42, "is-facility");
    add(4, 0, 7.4, 270, 126.7, 22, "is-label");
    add(2, 11, 19, 192, 57.6, 60, "is-facility");
    [0, 1, 2, 3, 4, 5, 6, 7].forEach((col) => add(5, col, col, 300));
    add(5, 8, 8, 300, 57.6, 70, "is-facility is-restroom");
    add(5, 10, 15, 322, 230.4, 22, "is-label");
    add(6, 0, 0, 422, 69, 22, "is-label");
    add(6, 11, 19, 392, 57.6, 60, "is-facility");
    for (let col = 0; col <= 18; col += 1) add(7, col, col, 462, 57.6, 80, "is-small");
    mountCanvas(canvas, 1180, 562);
  }

  function renderActiveBuilding() {
    if (!datasets) return;
    const building = BUILDINGS.find((item) => item.id === activeBuilding);
    title.textContent = building?.label || "농산물시장";
    sectionTabs.hidden = activeBuilding !== "cheonggwamul";
    buildingTabs.querySelectorAll("button").forEach((button) => {
      const selected = button.dataset.building === activeBuilding;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
    });
    if (activeBuilding === "cheonggwamul") renderMain(datasets.main);
    else if (activeBuilding === "mubaechu") renderMubaechu(datasets.annexes.mubaechu);
    else renderYangnyeom(datasets.annexes.yangnyeom);
    scroller.scrollTo({ top: 0, left: 0 });
  }

  search.addEventListener("input", () => { query = search.value; updateMatches(); }, { signal: abort.signal });
  BUILDINGS.forEach((building, index) => {
    const tab = element(documentRef, "button", {
      type: "button", class: `market-route-map-building-tab${index === 0 ? " is-active" : ""}`, text: building.label,
      "data-building": building.id,
      onClick: () => { activeBuilding = building.id; renderActiveBuilding(); },
    });
    buildingTabs.append(tab);
  });
  SECTION_TABS.forEach((section, index) => {
    const tab = element(documentRef, "button", {
      type: "button", class: `market-route-map-tab${index === 0 ? " is-active" : ""}`, text: section.label,
      onClick: () => {
        sectionTabs.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button === tab));
        cellElements.get(section.cellId)?.scrollIntoView?.({ behavior: "smooth", block: "start", inline: "start" });
      },
    });
    sectionTabs.append(tab);
  });
  const zoom = element(documentRef, "div", { class: "market-route-map-zoom", "aria-label": "지도 확대 축소" }, [
    iconButton(documentRef, "minus", "지도 축소", () => adjustScale(-0.1)), zoomValue,
    iconButton(documentRef, "plus", "지도 확대", () => adjustScale(0.1)),
  ]);
  const toolbar = element(documentRef, "div", { class: "market-route-map-toolbar" }, [
    element(documentRef, "div", { class: "market-route-map-search-wrap" }, [search, count]), zoom,
  ]);
  const content = element(documentRef, "div", { class: "market-route-map-content" }, [buildingTabs, toolbar, sectionTabs, state, scroller]);
  overlay.append(header, content);
  documentRef.body.append(overlay);
  documentRef.body.style.overflow = "hidden";
  closeButton.focus({ preventScroll: true });
  documentRef.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); }, { signal: abort.signal });

  Promise.all([
    windowRef.fetch(DATA_URL, { signal: abort.signal }),
    windowRef.fetch(ANNEX_DATA_URL, { signal: abort.signal }),
  ]).then(async ([mainResponse, annexResponse]) => {
    if (!mainResponse.ok || !annexResponse.ok) throw new Error(`market map ${mainResponse.status}/${annexResponse.status}`);
    const [main, annex] = await Promise.all([mainResponse.json(), annexResponse.json()]);
    datasets = { main, annexes: annex.buildings };
    renderActiveBuilding();
  }).catch((error) => {
    if (error?.name === "AbortError") return;
    state.textContent = "농산물시장 지도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    state.classList.add("is-error");
  });

  return { close };
}
