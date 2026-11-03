"use client";

/**
 * 各アプリに置く「意見」ボタン（正本は feedback-app/drop-in/。各アプリへは src/components/FeedbackButton.tsx にコピー）
 *
 * 押すと、いま見ている画面の写しをブラウザの中で撮り（modern-screenshot）、
 * 「問題／改善／その他」と本文を書いて送る。送り先は同じアプリの /api/feedback（drop-in/feedback-route.ts）で、
 * そこから集約アプリ（feedback-app）に届く。
 * 「状況を見る」タブでは、このアプリ宛てに送られた意見と対応状況・返事を見られる（送った人が自分の分を確認する用）。
 *
 * 使い方（layout.tsx の <body> の中に1行）:
 *   <FeedbackButton appName="購買管理システム" />
 *   ログイン不要（社内IP）のアプリでは askName を付けると名前欄が出る:
 *   <FeedbackButton appName="社内アプリ ポータル" askName />
 *   大画面表示用のページでは出さない: <FeedbackButton appName="..." hideOnPaths={["/display"]} />
 *
 * 必要な部品: npm i modern-screenshot
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type Kind = "bug" | "idea" | "other";
const KIND_LABELS: Record<Kind, string> = { bug: "問題（動かない・おかしい）", idea: "改善（こうしてほしい）", other: "その他" };

type Tab = "send" | "list";

type Item = {
  id: number;
  created_at: string;
  updated_at: string;
  kind: string;
  kind_label: string;
  status: string;
  status_label: string;
  body: string;
  sender: string;
  admin_note: string | null;
  has_shot: boolean;
  detail_url: string | null;
  mine: boolean;
};

const ACCENT = "#1F5FBF";
const DANGER = "#C2381F";

/** 送った意見を自分で消すための合鍵を、この端末（ブラウザ）に控えておく */
const TOKEN_KEY = "feedback-delete-tokens";
function loadTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
function saveToken(id: number, token: string) {
  try {
    const t = loadTokens();
    t[String(id)] = token;
    localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
  } catch {
    /* 保存できない端末では、ログインしている人だけが消せる */
  }
}
function dropToken(id: number) {
  try {
    const t = loadTokens();
    delete t[String(id)];
    localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
  } catch {
    /* 無視 */
  }
}
const OK = "#17734A";
const MAX_W = 1280; // 写しの横幅の上限（大きすぎる画像を送らない）

/** 写しの対象から外す印。ボタン自身と入力画面にはこれを付ける */
const IGNORE_ATTR = "data-feedback-ignore";

/** 画像ファイル（写真）を読み込んで、横幅を抑えた JPEG のデータURLにする */
async function fileToJpegDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_W / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** いま見えている範囲（ビューポート）の写しを撮る。失敗したら null */
async function captureViewport(): Promise<string | null> {
  try {
    const { domToJpeg } = await import("modern-screenshot");
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.min(1, MAX_W / Math.max(1, w));
    return await domToJpeg(document.documentElement, {
      quality: 0.8,
      scale,
      width: w,
      height: h,
      backgroundColor: "#ffffff",
      // スクロールしている分だけ上にずらして、見えている範囲を切り出す
      style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`, transformOrigin: "top left" },
      filter: (node) => !(node instanceof Element && node.hasAttribute(IGNORE_ATTR)),
    });
  } catch {
    return null;
  }
}

export default function FeedbackButton({
  appName,
  askName = false,
  hideOnPaths = [],
}: {
  appName: string;
  askName?: boolean;
  /** この先頭で始まるURLではボタンを出さない（大画面表示用のページなど）。例: ["/display"] */
  hideOnPaths?: string[];
}) {
  const pathname = usePathname() ?? "";
  const hidden = hideOnPaths.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"));
  const [open, setOpen] = useState(false);
  // スマホ（幅640px以下）では小さめのボタンにする
  const [isMobile, setIsMobile] = useState(false);
  // 入力欄にカーソルがある間・スマホのキーボードが開いている間は、ボタンを隠して入力の邪魔をしない
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onMq = () => setIsMobile(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);

    const isTyping = (el: Element | null) =>
      !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Element | null;
      // 自分の入力画面の中は除く（送る本文を書いている間に消えないように）
      if (t && t.closest(`[${IGNORE_ATTR}]`)) return;
      setInputFocused(isTyping(t));
    };
    const onFocusOut = () => setTimeout(() => setInputFocused(isTyping(document.activeElement)), 0);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    // キーボードが開くと見える範囲（visualViewport）の高さが縮む。7割未満なら開いていると見る
    const vv = window.visualViewport;
    const baseH = window.innerHeight;
    const onResize = () => {
      if (!vv) return;
      setKeyboardOpen(vv.height < baseH * 0.7);
    };
    vv?.addEventListener("resize", onResize);
    return () => {
      mq.removeEventListener("change", onMq);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      vv?.removeEventListener("resize", onResize);
    };
  }, []);
  const [tab, setTab] = useState<Tab>("send");
  const [capturing, setCapturing] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("idea");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null); // 赤字（エラー）
  const [note, setNote] = useState<string | null>(null); // 黒字（案内）
  const [sent, setSent] = useState(false);
  const [bodyRows, setBodyRows] = useState(4); // 本文の枠の高さ（行数）。「枠を広げる」で増やす
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 状況を見る
  const [items, setItems] = useState<Item[] | null>(null);
  const [listMsg, setListMsg] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [bigShot, setBigShot] = useState<number | null>(null); // 大きく表示中の写しのID
  const [sortBy, setSortBy] = useState<"new" | "status">("new"); // 並び順：新しい順／状態順
  const [statusFilter, setStatusFilter] = useState<string>(""); // 状態で絞る（空＝すべて）
  // この端末に控えてある「自分で消すための合鍵」（送信直後・一覧を開くたびに読み直す）
  const [tokens, setTokens] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) setTokens(loadTokens());
  }, [open]);

  const start = async () => {
    setCapturing(true);
    // ボタンが消えた状態で撮る（描画を1回待つ）
    await new Promise((r) => setTimeout(r, 50));
    const shot = await captureViewport();
    setImage(shot);
    setCapturing(false);
    setSent(false);
    setTab("send");
    setMsg(null);
    setNote(shot ? null : "画面の写しは撮れませんでしたが、写しなしでも送れます。必要なら「写真を選ぶ」で添えてください。");
    setOpen(true);
  };

  const retake = async () => {
    setOpen(false);
    await new Promise((r) => setTimeout(r, 80));
    const shot = await captureViewport();
    setImage(shot);
    setNote(shot ? null : "画面の写しは撮れませんでした。写しなしでも送れます。");
    setOpen(true);
  };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setImage(await fileToJpegDataUrl(f));
      setMsg(null);
    } catch {
      setMsg("この画像は読み込めませんでした。");
    }
  };

  const send = async () => {
    if (!body.trim()) {
      setMsg("内容を書いてください。");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app: appName,
          pageUrl: location.href,
          pageTitle: document.title,
          kind,
          body: body.trim(),
          userName: name.trim() || null,
          image,
          screen: `${window.innerWidth}x${window.innerHeight}`,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: number | null; token?: string | null; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error ?? "送信に失敗しました。時間をおいて試してください。");
      if (d.id && d.token) saveToken(d.id, d.token);
      setTokens(loadTokens());
      setSent(true);
      setBody("");
      setImage(null);
      setBodyRows(4);
      setNote(null);
      setItems(null); // 次に「状況を見る」を開いたら取り直す
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadList = async () => {
    setListMsg("読み込み中...");
    try {
      const res = await fetch("/api/feedback", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { items?: Item[]; loggedIn?: boolean; error?: string };
      if (!res.ok) throw new Error(d.error ?? "読み込みに失敗しました。");
      setItems(d.items ?? []);
      setLoggedIn(!!d.loggedIn);
      setListMsg(null);
    } catch (e) {
      setItems([]);
      setListMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const showList = () => {
    setTab("list");
    setTokens(loadTokens());
    if (items === null) void loadList();
  };

  const removeItem = async (it: Item) => {
    if (!window.confirm(`#${it.id} の意見を削除します。元に戻せません。よろしいですか？`)) return;
    setListMsg("削除中...");
    try {
      const res = await fetch("/api/feedback", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: it.id, token: tokens[String(it.id)] ?? null }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error ?? "削除できませんでした。");
      dropToken(it.id);
      setTokens(loadTokens());
      await loadList();
    } catch (e) {
      setListMsg(e instanceof Error ? e.message : String(e));
    }
  };

  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const input: React.CSSProperties = {
    width: "100%",
    minHeight: 44,
    border: "1px solid #666666",
    borderRadius: 4,
    padding: "8px 12px",
    fontSize: 16,
    background: "#fff",
    color: "#1A1A1A",
    boxSizing: "border-box",
  };
  const btn: React.CSSProperties = {
    minHeight: 44,
    padding: "0 16px",
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  };
  const btnSecondary: React.CSSProperties = { ...btn, background: "#fff", color: ACCENT, border: `1px solid ${ACCENT}` };
  const btnGray: React.CSSProperties = { ...btn, background: "#fff", color: "#1A1A1A", border: "1px solid #666666" };
  const tabStyle = (active: boolean): React.CSSProperties => ({
    ...btn,
    flex: 1,
    background: active ? ACCENT : "#fff",
    color: active ? "#fff" : ACCENT,
    border: `1px solid ${ACCENT}`,
  });
  const statusStyle = (s: string): React.CSSProperties =>
    s === "done"
      ? { background: OK, color: "#fff" }
      : s === "open"
        ? { background: "#fff", color: ACCENT, border: `1px solid ${ACCENT}` }
        : s === "rejected"
          ? { background: "#fff", color: "#666666", border: "1px solid #666666" }
          : { background: "#F4F4F4", color: "#1A1A1A" };

  const STATUS_ORDER: Record<string, number> = { open: 0, doing: 1, hold: 2, done: 3, rejected: 4 };
  const STATUS_LABELS: Record<string, string> = { open: "未対応", doing: "対応中", hold: "保留", done: "完了", rejected: "不採用" };
  const visibleItems = (items ?? [])
    .filter((it) => !onlyMine || it.mine)
    .filter((it) => !statusFilter || it.status === statusFilter)
    .sort((a, b) =>
      sortBy === "status"
        ? (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.id - a.id
        : b.id - a.id
    );
  const mineCount = (items ?? []).filter((it) => it.mine).length;
  const selectStyle: React.CSSProperties = { ...input, width: "auto", minWidth: 140 };

  if (hidden) return null;

  return (
    <>
      {!open && !capturing && !inputFocused && !keyboardOpen && (
        <button
          type="button"
          {...{ [IGNORE_ATTR]: "" }}
          onClick={start}
          // Tab キーやハンディスキャナーの入力がこのボタンに移らないように、キーボードの順番から外す
          tabIndex={-1}
          aria-label="このアプリへの意見・不具合を送る"
          style={{
            position: "fixed",
            right: isMobile ? 12 : 16,
            bottom: isMobile ? 12 : 16,
            zIndex: 9990,
            ...btn,
            ...(isMobile ? { minHeight: 36, padding: "0 12px", fontSize: 14, opacity: 0.9 } : {}),
            background: ACCENT,
            color: "#fff",
            border: "none",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          }}
        >
          意見
        </button>
      )}

      {open && (
        <div
          {...{ [IGNORE_ATTR]: "" }}
          role="dialog"
          aria-modal="true"
          aria-label="意見・不具合の報告"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fff",
              color: "#1A1A1A",
              borderRadius: 8,
              width: "100%",
              maxWidth: 560,
              maxHeight: "calc(100dvh - 32px)",
              overflowY: "auto",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              fontSize: 16,
              lineHeight: 1.25,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: 20 }}>意見・不具合の報告</strong>
              <button type="button" onClick={() => setOpen(false)} aria-label="閉じる" style={{ ...btn, background: "none", border: "none", color: "#1A1A1A" }}>
                ✕
              </button>
            </div>

            <div style={{ display: "flex", gap: 8 }} role="tablist">
              <button type="button" role="tab" aria-selected={tab === "send"} onClick={() => setTab("send")} style={tabStyle(tab === "send")}>
                送る
              </button>
              <button type="button" role="tab" aria-selected={tab === "list"} onClick={showList} style={tabStyle(tab === "list")}>
                状況を見る
              </button>
            </div>

            {tab === "list" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <p style={{ margin: 0, fontSize: 14, color: "#666666", lineHeight: 1.5 }}>
                  このアプリ（{appName}）宛てに送られた意見と対応状況です。返事が付くとここに出ます。自分が送ったものは「この意見を削除」で消せます。
                </p>
                {loggedIn && mineCount > 0 && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer" }}>
                    <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} style={{ width: 20, height: 20 }} />
                    自分が送ったものだけ（{mineCount}件）
                  </label>
                )}
                {items !== null && items.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
                      並び順
                      <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "new" | "status")} style={selectStyle} aria-label="並び順">
                        <option value="new">新しい順</option>
                        <option value="status">状態順（未対応が先）</option>
                      </select>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
                      状態
                      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle} aria-label="状態で絞る">
                        <option value="">すべて</option>
                        {Object.keys(STATUS_ORDER).map((k) => (
                          <option key={k} value={k}>
                            {STATUS_LABELS[k]}（{(items ?? []).filter((it) => it.status === k && (!onlyMine || it.mine)).length}）
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {listMsg && <p style={{ margin: 0 }}>{listMsg}</p>}
                {items !== null && !listMsg && visibleItems.length === 0 && <p style={{ margin: 0 }}>該当するものはありません。</p>}
                {visibleItems.map((it) => (
                  <div key={it.id} style={{ border: "1px solid #DDDDDD", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 14 }}>
                      <span style={{ padding: "4px 8px", borderRadius: 4, background: "#F4F4F4" }}>{it.kind_label}</span>
                      <span style={{ padding: "4px 8px", borderRadius: 4, fontWeight: 700, ...statusStyle(it.status) }}>{it.status_label}</span>
                      {it.mine && <span style={{ color: ACCENT, fontWeight: 700 }}>自分</span>}
                      <span style={{ color: "#666666" }}>
                        #{it.id}　{it.sender}　{it.created_at}
                      </span>
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{it.body}</div>
                    {it.admin_note && (
                      <div style={{ background: "#F4F4F4", borderRadius: 4, padding: 8, lineHeight: 1.5 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: OK, marginBottom: 4 }}>返事（{it.updated_at}）</div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{it.admin_note}</div>
                      </div>
                    )}
                    {(it.mine || !!tokens[String(it.id)]) && (
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          onClick={() => void removeItem(it)}
                          style={{ ...btn, minHeight: 36, fontSize: 14, fontWeight: 400, background: "#fff", color: DANGER, border: `1px solid ${DANGER}` }}
                        >
                          この意見を削除
                        </button>
                      </div>
                    )}
                    {it.has_shot && (
                      <button
                        type="button"
                        onClick={() => setBigShot(bigShot === it.id ? null : it.id)}
                        aria-label={bigShot === it.id ? "写しを小さくする" : "写しを大きく見る"}
                        style={{ alignSelf: "flex-start", padding: 0, border: "1px solid #DDDDDD", borderRadius: 4, background: "#F4F4F4", cursor: "pointer", minHeight: 44, minWidth: 44, overflow: "hidden" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/feedback?shot=${it.id}`}
                          alt={`#${it.id} の画面の写し`}
                          // loading="lazy" は付けない（浮かぶ入力画面の中では読み込みが始まらない。2026-09-24 本番で確認）
                          style={bigShot === it.id ? { width: "100%", display: "block" } : { width: 120, height: 80, objectFit: "cover", objectPosition: "top", display: "block" }}
                        />
                      </button>
                    )}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => void loadList()} style={btnSecondary}>
                    最新にする
                  </button>
                  <button type="button" onClick={() => setOpen(false)} style={btnGray}>
                    閉じる
                  </button>
                </div>
              </div>
            ) : sent ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <p style={{ fontSize: 18, fontWeight: 700, color: OK, margin: 0 }}>送りました。ありがとうございます。</p>
                <p style={{ margin: 0, lineHeight: 1.5 }}>対応状況や返事は「状況を見る」で確認できます。</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={showList} style={btnSecondary}>
                    状況を見る
                  </button>
                  <button type="button" onClick={() => setOpen(false)} style={btnGray}>
                    閉じる
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>画面の写し（無くても送れます）</div>
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt="いまの画面の写し" style={{ width: "100%", border: "1px solid #DDDDDD", borderRadius: 4, display: "block" }} />
                  ) : (
                    <div style={{ padding: 16, background: "#F4F4F4", borderRadius: 4, fontSize: 14 }}>写しなし（このまま送れます）</div>
                  )}
                  {note && <p style={{ margin: "8px 0 0", fontSize: 14, color: "#666666", lineHeight: 1.5 }}>{note}</p>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <button type="button" onClick={retake} style={btnSecondary}>
                      {image ? "撮り直す" : "画面を撮る"}
                    </button>
                    <button type="button" onClick={() => fileRef.current?.click()} style={btnSecondary}>
                      写真を選ぶ
                    </button>
                    {image && (
                      <button type="button" onClick={() => { setImage(null); setNote(null); }} style={btnGray}>
                        写しを付けない
                      </button>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
                  </div>
                </div>

                <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                  <legend style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>種類</legend>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                      <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer" }}>
                        <input type="radio" name="feedback-kind" value={k} checked={kind === k} onChange={() => setKind(k)} style={{ width: 20, height: 20 }} />
                        {KIND_LABELS[k]}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label htmlFor="feedback-body" style={{ display: "block", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                    どんなことですか？（何が困る・どうしてほしい）
                  </label>
                  <textarea
                    id="feedback-body"
                    ref={bodyRef}
                    rows={bodyRows}
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value);
                      // 書いた分だけ枠を自動で伸ばす（縮めはしない）
                      const el = e.target;
                      const lines = Math.ceil((el.scrollHeight - 16) / 24);
                      if (lines > bodyRows) setBodyRows(Math.min(lines, 30));
                    }}
                    placeholder="例：発注一覧で日付を選ぶと前の日になってしまう／品番を入れる欄をもっと大きくしてほしい"
                    style={{ ...input, lineHeight: 1.5, resize: "vertical" }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setBodyRows((r) => Math.min(r + 6, 30));
                        bodyRef.current?.focus();
                      }}
                      style={{ ...btnGray, fontWeight: 400 }}
                    >
                      枠を広げる
                    </button>
                  </div>
                </div>

                {askName && (
                  <div>
                    <label htmlFor="feedback-name" style={{ display: "block", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                      お名前（任意）
                    </label>
                    <input id="feedback-name" value={name} onChange={(e) => setName(e.target.value)} style={input} placeholder="例：山田" />
                  </div>
                )}

                {msg && <p style={{ margin: 0, color: "#C2381F", fontSize: 16 }}>{msg}</p>}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setOpen(false)} style={btnGray}>
                    やめる
                  </button>
                  <button type="button" onClick={send} disabled={busy} style={{ ...btn, background: ACCENT, color: "#fff", border: "none", opacity: busy ? 0.5 : 1 }}>
                    {busy ? "送信中..." : "送る"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
