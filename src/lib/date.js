import { WEEKDAYS } from "../config.js";

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key) {
  return new Date(`${key}T00:00:00`);
}

export function addDays(key, amount) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

export function todayKey() {
  return toDateKey(new Date());
}

export function formatShort(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

export function formatLong(key) {
  const date = parseDateKey(key);
  return `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일(${WEEKDAYS[date.getDay()]})`;
}

export function formatLongShort(key) {
  const date = parseDateKey(key);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}(${WEEKDAYS[date.getDay()]})`;
}

// 화면 제목/헤더에 쓰는 짧은 전체형: 연도 없이 "9월 18일 (목)". 0으로 채우지 않는다.
export function formatMonthDayFull(key) {
  const date = parseDateKey(key);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
}

// 스티키 바 · 칩처럼 좁은 자리에 쓰는 축약형: "9/18". 0으로 채우지 않는다.
export function formatMonthDayShort(key) {
  const date = parseDateKey(key);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// 날짜의 "은/는" 조사는 일(day)의 마지막 자리를 읽는 소리(받침 유무)에 따라 갈린다.
// 0,1,3,6,7,8로 끝나면 받침이 있어 "은"(예: 26일→이십육, 30일→삼십), 2,4,5,9로 끝나면 "는".
const EUN_TOPIC_LAST_DIGITS = new Set([0, 1, 3, 6, 7, 8]);
export function eunNeunParticle(day) {
  return EUN_TOPIC_LAST_DIGITS.has(Math.abs(Number(day)) % 10) ? "은" : "는";
}
