import { buildRouteNoteShareUrl, normalizeRouteNoteShareDays } from "../services/route-note-share.js";

function node(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "disabled") element.disabled = Boolean(value);
    else if (key === "selected") element.selected = Boolean(value);
    else if (key.startsWith("on")) element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, String(value));
  }
  children.flat().filter(Boolean).forEach((child) => element.append(child));
  return element;
}

function formatExpiry(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(time) : "만료 시각 확인 필요";
}

function errorText(error) {
  const raw = String(error?.message || "");
  if (/[가-힣]/.test(raw)) return raw;
  if (/permission|forbidden|rls/i.test(raw)) return "이 구역의 공유 링크를 관리할 권한이 없습니다.";
  return "공유 링크를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; }
  return false;
}

/** Modal controller. The route-notes controller owns the share button and passes the selected zone. */
export function createRouteNoteShareDialog({ service, getShareBaseUrl = () => globalThis.location?.href, onChanged = () => {} } = {}) {
  if (!service?.create || !service?.list || !service?.update) throw new Error("공유 링크 서비스를 찾을 수 없습니다.");
  let overlay = null, zone = null, openedBy = null, loading = false, generation = 0, keyHandler = null, latestUrl = "";
  const close = () => {
    generation += 1;
    loading = false;
    if (!overlay) return;
    document.removeEventListener("keydown", keyHandler);
    overlay.remove(); overlay = null; zone = null; latestUrl = "";
    openedBy?.focus?.(); openedBy = null;
  };
  const status = (message, kind = "", token = generation) => {
    if (token !== generation) return;
    const target = overlay?.querySelector("[data-share-status]");
    if (target) { target.textContent = message; target.dataset.kind = kind; }
  };
  function durationInput(value = 7) {
    const select = node("select", { class: "route-notes-share-select", "aria-label": "공유 기간" });
    [1, 3, 7, 14, 30].forEach((days) => select.append(node("option", { value: days, text: `${days}일`, selected: days === value })));
    return select;
  }
  function renderRows(rows, token = generation) {
    if (token !== generation) return;
    const host = overlay?.querySelector("[data-share-list]"); if (!host) return;
    host.replaceChildren();
    if (!rows.length) { host.append(node("p", { class: "route-notes-share-empty", text: "이 구역을 공유 중인 링크가 없습니다." })); return; }
    rows.forEach((share) => {
      const revoked = Boolean(share.revoked_at), expired = !revoked && Date.parse(share.expires_at || "") <= Date.now();
      const select = durationInput(7);
      const state = revoked ? "중지됨" : expired ? "기간 만료" : `~ ${formatExpiry(share.expires_at)}`;
      const extend = node("button", { type: "button", class: "route-notes-button secondary", text: "기간 연장", disabled: revoked, onClick: async (event) => {
        if (loading) return;
        const token = generation;
        const actionButton = event.currentTarget;
        try { loading = true; actionButton.disabled = true; status("기간을 변경하는 중입니다.", "", token); await service.update(share.id, { expiresInDays: normalizeRouteNoteShareDays(select.value) }); if (token !== generation) return; await refresh(token); onChanged(); }
        catch (error) { status(errorText(error), "error", token); } finally { if (token === generation) { loading = false; actionButton.disabled = false; } }
      } });
      const revoke = node("button", { type: "button", class: "route-notes-button danger", text: "공유 중지", disabled: revoked, onClick: async (event) => {
        if (loading) return;
        if (!window.confirm("이 링크를 중지할까요? 중지한 링크는 다시 열 수 없습니다.")) return;
        const token = generation;
        const actionButton = event.currentTarget;
        try { loading = true; actionButton.disabled = true; status("공유를 중지하는 중입니다.", "", token); await service.update(share.id, { revoke: true }); if (token !== generation) return; await refresh(token); onChanged(); }
        catch (error) { status(errorText(error), "error", token); } finally { if (token === generation) { loading = false; actionButton.disabled = false; } }
      } });
      host.append(node("article", { class: "route-notes-share-row" }, [node("div", {}, [node("strong", { text: state }), node("small", { text: `만든 시각 ${formatExpiry(share.created_at)}` })]), node("div", { class: "route-notes-share-row-actions" }, [select, extend, revoke])]));
    });
  }
  async function refresh(token = generation) {
    if (!zone || !overlay) return;
    const zoneId = zone.id;
    try { const rows = await service.list(zoneId); if (token !== generation || zone?.id !== zoneId) return; renderRows(rows, token); }
    catch (error) { status(errorText(error), "error", token); }
  }
  function render() {
    const titleId = "routeNoteShareTitle";
    const days = durationInput(7);
    const urlInput = node("input", { class: "route-notes-share-url", type: "text", readonly: "readonly", hidden: true, "aria-label": "새 공유 링크", "data-share-url": "" });
    const copyButton = node("button", { type: "button", class: "route-notes-button secondary", text: "링크 복사", disabled: true, onClick: async () => {
      const token = generation;
      const copied = await copyText(latestUrl).catch(() => false);
      if (token !== generation) return;
      if (copied) status("링크를 복사했습니다.", "success", token);
      else { urlInput.focus(); urlInput.select(); status("주소를 길게 눌러 복사해 주세요.", "", token); }
    } });
    const create = node("button", { type: "button", class: "route-notes-button primary", text: "링크 만들기", onClick: async (event) => {
      if (loading) return;
      const token = generation, zoneId = zone.id;
      const actionButton = event.currentTarget;
      try {
        loading = true; actionButton.disabled = true; status("공유 링크를 만드는 중입니다.", "", token);
        const share = await service.create(zoneId, normalizeRouteNoteShareDays(days.value));
        if (token !== generation || zone?.id !== zoneId) return;
        const url = buildRouteNoteShareUrl(share.token, getShareBaseUrl());
        latestUrl = url; urlInput.value = url; urlInput.hidden = false; copyButton.disabled = false;
        const copied = await copyText(url).catch(() => false);
        await refresh(token); if (token !== generation) return;
        status(copied ? `${formatExpiry(share.expires_at)}까지 유효한 링크를 복사했습니다.` : `${formatExpiry(share.expires_at)}까지 유효한 링크입니다. 아래 주소를 복사해 주세요.`, "success", token);
        onChanged();
      } catch (error) { status(errorText(error), "error", token); } finally { if (token === generation) { loading = false; actionButton.disabled = false; } }
    } });
    overlay = node("div", { class: "route-notes-share-overlay", role: "presentation", onClick: (event) => { if (event.target === overlay) close(); } }, [
      node("section", { class: "route-notes-share-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" }, [
        node("header", { class: "route-notes-share-heading" }, [node("div", {}, [node("p", { class: "route-notes-kicker", text: "기간 공유" }), node("h2", { id: titleId, text: zone.name || "구역 메모" })]), node("button", { type: "button", class: "route-notes-button secondary", text: "닫기", onClick: close })]),
        node("p", { class: "route-notes-share-help", text: "로그인 없이 이 구역의 메모와 사진을 볼 수 있는 읽기 전용 링크입니다. 링크를 받은 사람에게만 보내고, 필요하면 바로 중지하세요. 이미 본 내용이나 저장한 사진은 회수할 수 없습니다." }),
        node("div", { class: "route-notes-share-create" }, [node("label", { text: "유효 기간" }, [days]), create]),
        node("div", { class: "route-notes-share-url-row" }, [urlInput, copyButton]),
        node("p", { class: "route-notes-share-status", role: "status", "aria-live": "polite", "data-share-status": "" }),
        node("h3", { text: "내가 만든 링크" }), node("div", { class: "route-notes-share-list", "data-share-list": "" }),
      ]),
    ]);
    document.body.append(overlay); overlay.querySelector(".route-notes-share-dialog")?.focus(); refresh();
    keyHandler = (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...overlay.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")]
        .filter((element) => !element.hidden && !element.closest("[hidden]"));
      if (!focusable.length) return;
      const current = focusable.indexOf(document.activeElement);
      if (event.shiftKey && current <= 0) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && current === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener("keydown", keyHandler);
  }
  return {
    open({ zone: nextZone, trigger } = {}) {
      if (!nextZone?.id) throw new Error("공유할 구역을 찾을 수 없습니다.");
      close(); zone = nextZone; openedBy = trigger || document.activeElement; render();
    },
    reset: close,
    isOpen: () => Boolean(overlay),
    handleBack: () => {
      if (!overlay) return false;
      close(); return true;
    },
  };
}
