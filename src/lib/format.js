const fmt = new Intl.NumberFormat("ko-KR");

export function fmtWon(value) {
  return `${fmt.format(Math.round(Number(value) || 0))}원`;
}

export function fmtCount(value) {
  return `${fmt.format(Math.round(Number(value) || 0))}건`;
}

export function fmtNum(value) {
  return fmt.format(Math.round(Number(value) || 0));
}

// Compact Korean won formatters (만/억 units). Extracted from main.js.

export function formatCalendarWon(value) {
  const n = Math.round(Number(value) || 0);
  if (!n) return "";
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만`;
  return n.toLocaleString("ko-KR");
}

export function formatKoreanWon(value) {
  const n = Math.round(value);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 100000000) return `${(n / 100000000).toFixed(abs >= 1000000000 ? 0 : 1).replace(/\.0$/, "")}억`;
  if (abs >= 10000) return `${Math.round(n / 10000)}만`;
  return n.toLocaleString("ko-KR");
}

export function formatCompactWonWithUnit(value) {
  const n = Math.round(Number(value) || 0);
  if (!n) return "0원";
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만원`;
  return `${n.toLocaleString("ko-KR")}원`;
}
