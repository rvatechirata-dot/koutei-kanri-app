/**
 * このアプリの日時は、データベースにも「日本時間の文字」で入れる（migrations/0001_init.sql の冒頭）。
 *   日時＝'YYYY/MM/DD HH:MM'、日付＝'YYYY/MM/DD'
 * エムネットのCSV・川﨑課長の試作のデータと同じ形なので、取り込みでそのまま比べられる。
 * Workers の時計はUTCなので、9時間足して作る。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function jstParts(d: Date) {
  const t = new Date(d.getTime() + JST_OFFSET_MS).toISOString(); // "2026-11-03T20:34:00.000Z"（日本時間の数字）
  return { date: t.slice(0, 10).replace(/-/g, "/"), time: t.slice(11, 16) };
}

/** 今の日本時間「2026/11/03 20:34」 */
export function nowJst(d = new Date()): string {
  const p = jstParts(d);
  return `${p.date} ${p.time}`;
}

/** 今日の日本時間の日付「2026/11/03」 */
export function todayJst(d = new Date()): string {
  return jstParts(d).date;
}
