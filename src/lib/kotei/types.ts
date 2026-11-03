// 表の1行の形（列名は migrations/0001_init.sql と同じ）。数・日時もすべて文字で持つ。

export interface CaseRow {
  id: string;
  mgmt_no: string;
  sales_rep: string;
  customer_po: string;
  customer: string;
  customer_contact: string;
  order_date: string;
  bulk_due: string;
  link: string;
  note: string;
  annotation: string;
  hidden: string;
  updated_at: string;
  updated_by: string;
}

export interface ItemRow {
  id: string;
  case_id: string;
  barcode: string;
  kubun: string;
  kubun2: string;
  ext_barcode: string;
  drawing_no: string;
  name: string;
  unit_price: string;
  qty: string;
  final_due: string;
  link: string;
  knowhow: string;
  note: string;
  hidden: string;
  delivery_json: string;
  updated_at: string;
  updated_by: string;
  source: string;
}

export interface ProcRow {
  id: string;
  item_id: string;
  seq: string;
  in_out: string;
  mnet_slot: string;
  name: string;
  assignee: string;
  machine: string;
  plan_start: string;
  due: string;
  started_at: string;
  done_at: string;
  done_qty: string;
  inspected_on: string;
  inspector: string;
  unit_price: string;
  std_time: string;
  note: string;
  extra_json: string;
  started_by: string;
  done_by: string;
  defect_qty: string;
  comment: string;
  defect_reason: string;
}

export interface MasterRow {
  id: string;
  kind: string;
  name: string;
  aliases: string;
  sort_order: string;
  unused: string;
  memo: string;
}

/** CSVの1行から作る「案件・品目・工程」（IDなど、CSVに無い列はまだ入っていない） */
export type CaseFields = Omit<CaseRow, "id" | "updated_at" | "updated_by">;
export type ItemFields = Omit<ItemRow, "id" | "case_id" | "updated_at" | "updated_by" | "source">;
export type ProcFields = Omit<ProcRow, "id" | "item_id" | "started_by" | "done_by" | "defect_qty" | "comment" | "defect_reason">;

export interface CsvRec {
  line: number; // CSVの何行目か
  a: CaseFields;
  i: ItemFields;
  p: ProcFields[];
}

/** 画面のラベル（取り込みの「何が変わったか」の文に使う） */
export const CASE_LABEL: Record<keyof CaseFields, string> = {
  mgmt_no: "社内管理番号",
  sales_rep: "営業担当",
  customer_po: "顧客発注番号",
  customer: "顧客",
  customer_contact: "顧客の担当者",
  order_date: "受注日",
  bulk_due: "一括納期",
  link: "リンク",
  note: "備考",
  annotation: "注釈",
  hidden: "隠す",
};

export const ITEM_LABEL: Record<keyof ItemFields, string> = {
  barcode: "バーコード番号",
  kubun: "区分",
  kubun2: "区分2",
  ext_barcode: "社外バーコード",
  drawing_no: "図面番号",
  name: "品名",
  unit_price: "単価",
  qty: "数量",
  final_due: "最終納期",
  link: "リンク",
  knowhow: "ノウハウ",
  note: "備考",
  hidden: "隠す",
  delivery_json: "納品情報",
};

export const PROC_LABEL: Partial<Record<keyof ProcRow, string>> = {
  seq: "順番",
  in_out: "社内外注",
  name: "工程名",
  assignee: "担当者",
  machine: "機械",
  plan_start: "開始予定",
  due: "納期",
  started_at: "開始日時",
  done_at: "完了日時",
  done_qty: "完成数量",
  inspected_on: "検査日",
  inspector: "検査者",
  unit_price: "工程単価",
  std_time: "基準時間",
  note: "備考",
  extra_json: "その他",
};
