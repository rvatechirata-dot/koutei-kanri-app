/**
 * エムネットの「案件一覧」書き出しCSVを読む（画面とサーバーの両方で使う。データベースには触らない）。
 *
 * 川﨑課長の試作（index.html の parseCsv・decode・recOf・analyze の前半）と同じ読み方にしてある。
 * - 列は見出しの名前ではなく「位置」で読む。2行目の1列目が「社内管理番号」、12列目が「バーコード番号」、列が64以上で確かめる。
 * - 3行目が「全部数字」の行なら欄の文字数の行なので読み飛ばす。
 * - 0〜10＝案件、11〜23＝品目、24〜63＝納品情報（5件×8列）、64〜＝工程（42列で1組＝社内17列＋外注25列）。
 * - バーコード番号が空の行・同じバーコードの2回目は飛ばす。数字だけでないバーコードは知らせるだけ（エクセルで壊れた疑い）。
 * ※ エムネットの列の並びが変わると読めなくなる（見出しの名前では見ていない）。
 */
import type { CsvRec, ProcFields } from "./types";

/** ダブルクォートの中の改行・カンマ・"" に対応。空行は捨てる */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let r: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      r.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      r.push(f);
      rows.push(r);
      r = [];
      f = "";
    } else f += c;
  }
  if (f !== "" || r.length) {
    r.push(f);
    rows.push(r);
  }
  return rows.filter((x) => x.some((v) => v !== ""));
}

/** 文字コードを決めて読む（ブラウザで使う）。Shift_JIS を先に試し、「社内管理番号」が読めなければ UTF-8 */
export function decodeCsv(buf: ArrayBuffer): string {
  const sj = new TextDecoder("shift_jis").decode(buf);
  if (sj.indexOf("社内管理番号") >= 0) return sj;
  const u8 = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
  return u8.indexOf("社内管理番号") >= 0 ? u8 : sj;
}

/** 全角の数字・記号を半角にして前後の空白を取る */
export const han = (s: unknown) =>
  String(s ?? "")
    .replace(/[０-９．－，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .trim();
const txt = (s: unknown) => String(s ?? "").replace(/\r\n?/g, "\n").trim();

/** 日付を YYYY/MM/DD にそろえる */
export function nd(s: unknown): string {
  const m = han(s).match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  return m ? m[1] + "/" + m[2].padStart(2, "0") + "/" + m[3].padStart(2, "0") : han(s);
}

/** 日付＋時刻。時刻が 00:00 や空なら日付だけ */
function dt(date: unknown, time: unknown): string {
  const d = nd(date);
  if (!d) return "";
  const t = han(time).match(/^(\d{1,2}):(\d{2})/);
  return t && !(t[1] === "00" && t[2] === "00") && !(t[1] === "0" && t[2] === "00") ? d + " " + t[1].padStart(2, "0") + ":" + t[2] : d;
}

/** 空でないものだけ、並びをそろえて文字にする（比べやすいように） */
function extra(o: Record<string, string>): string {
  const k = Object.keys(o)
    .filter((x) => o[x] !== "" && o[x] !== undefined)
    .sort();
  if (!k.length) return "";
  const out: Record<string, string> = {};
  k.forEach((x) => {
    out[x] = o[x];
  });
  return JSON.stringify(out);
}

const SHIP = ["お届け情報", "納品/出荷日", "納品担当者", "荷物個数", "配送業者", "配送伝票番号", "配送時間指定", "備考"];

/** 1行（＝1品目）を 案件・品目・工程 に分ける */
export function recOf(r: string[], line: number): CsvRec {
  const a = {
    mgmt_no: txt(r[0]),
    sales_rep: txt(r[1]),
    customer_po: txt(r[2]),
    customer: txt(r[3]),
    customer_contact: txt(r[4]),
    order_date: nd(r[5]),
    bulk_due: nd(r[6]),
    link: txt(r[7]),
    note: txt(r[8]),
    annotation: txt(r[9]),
    hidden: han(r[10]) === "1" ? "1" : "",
  };
  const ships: Record<string, string>[] = [];
  for (let k = 0; k < 5; k++) {
    const s: Record<string, string> = {};
    SHIP.forEach((h, j) => {
      const v = txt(r[24 + k * 8 + j]);
      if (v) s[h] = h === "納品/出荷日" ? nd(v) : v;
    });
    if (Object.keys(s).length) ships.push(s);
  }
  const i = {
    barcode: han(r[11]),
    kubun: txt(r[12]),
    kubun2: txt(r[13]),
    ext_barcode: txt(r[14]),
    drawing_no: txt(r[15]),
    name: txt(r[16]),
    unit_price: han(r[17]),
    qty: han(r[18]),
    final_due: nd(r[19]),
    link: txt(r[20]),
    knowhow: txt(r[21]),
    note: txt(r[22]),
    hidden: han(r[23]) === "1" ? "1" : "",
    delivery_json: ships.length ? JSON.stringify(ships) : "",
  };
  const p: ProcFields[] = [];
  const pairs = Math.floor((r.length - 64) / 42);
  for (let n = 0; n < pairs; n++) {
    const b = 64 + 42 * n;
    if (txt(r[b]))
      p.push({
        seq: "",
        in_out: "社内",
        mnet_slot: "社内" + (n + 1),
        name: txt(r[b]),
        assignee: txt(r[b + 1]),
        plan_start: dt(r[b + 2], r[b + 3]),
        due: dt(r[b + 4], r[b + 5]),
        started_at: dt(r[b + 6], r[b + 7]),
        done_at: dt(r[b + 8], r[b + 9]),
        inspected_on: nd(r[b + 10]),
        inspector: txt(r[b + 11]),
        unit_price: han(r[b + 12]),
        std_time: han(r[b + 13]),
        note: txt(r[b + 15]),
        machine: txt(r[b + 16]),
        extra_json: extra({ リンク: txt(r[b + 14]) }),
        done_qty: "",
      });
    const o = b + 17;
    if (txt(r[o]))
      p.push({
        seq: "",
        in_out: "外注",
        mnet_slot: "外注" + (n + 1),
        name: txt(r[o]),
        assignee: txt(r[o + 1]),
        unit_price: han(r[o + 2]),
        plan_start: dt(r[o + 5], r[o + 6]),
        started_at: dt(r[o + 7], r[o + 8]),
        due: dt(r[o + 10], r[o + 11]) || nd(r[o + 4]),
        done_at: dt(r[o + 12], r[o + 13]),
        inspected_on: nd(r[o + 15]),
        inspector: txt(r[o + 16]),
        note: txt(r[o + 19]),
        machine: "",
        std_time: "",
        done_qty: "",
        extra_json: extra({
          発注期限: nd(r[o + 3]),
          工程納期: nd(r[o + 4]),
          発注者: txt(r[o + 9]),
          受領者: txt(r[o + 14]),
          検査結果: txt(r[o + 17]),
          リンク: txt(r[o + 18]),
          材料発注: han(r[o + 20]) === "1" ? "1" : "",
          材料調達方法: txt(r[o + 21]),
          材料名称: txt(r[o + 22]),
          材料サイズ: txt(r[o + 23]),
          材料注文数量: han(r[o + 24]),
        }),
      });
  }
  p.forEach((x, k) => {
    x.seq = String(k + 1);
  });
  return { a, i, p, line };
}

export interface CsvRead {
  fatal?: string;
  errs: string[];
  recs: CsvRec[];
}

/** CSVの文字を読んで、取り込む行（バーコードで1行ずつ）にする */
export function readMnetCsv(text: string): CsvRead {
  const rows = parseCsv(text);
  const errs: string[] = [];
  if (rows.length < 2 || rows[1][0] !== "社内管理番号" || rows[1][11] !== "バーコード番号" || rows[1].length < 64)
    return {
      fatal: "エムネットの「案件一覧」の書き出しCSVではないようです（2行目の見出しが「社内管理番号…バーコード番号…」になっていません）。",
      errs,
      recs: [],
    };
  let start = 2;
  if (rows[2] && /^\d+$/.test(rows[2][0]) && /^\d+$/.test(rows[2][11])) start = 3; // 3行目は欄の文字数の行
  const recs: CsvRec[] = [];
  const seen: Record<string, number> = {};
  for (let k = start; k < rows.length; k++) {
    const rec = recOf(rows[k], k + 1);
    const bc = rec.i.barcode;
    if (!bc) {
      errs.push(`${rec.line}行目：バーコード番号が空なので飛ばします（${rec.a.mgmt_no}）。エムネットに取り込んだあとで書き出したCSVを使ってください`);
      continue;
    }
    if (!/^\d+$/.test(bc)) errs.push(`${rec.line}行目：バーコード番号が数字だけではありません（${bc}）。エクセルで開いて保存したCSVかもしれません`);
    if (seen[bc]) {
      errs.push(`${rec.line}行目：バーコード番号 ${bc} が ${seen[bc]}行目と同じなので飛ばします`);
      continue;
    }
    seen[bc] = rec.line;
    recs.push(rec);
  }
  return { errs, recs };
}
