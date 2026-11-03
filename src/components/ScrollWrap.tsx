"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 表の箱（.tbl-wrap）。横にはみ出すときは、横スクロールバーを表の「上」にも出す。
 * 表の箱は縦にもスクロールするので、下のバーは表をいちばん下まで送らないと見えない。上のバーと表は連動する。
 * 平田さんの標準ルール（2026-10-06）：横にスクロールする表は必ずこれで包む（新しいアプリにもコピーする）。
 * スマホ・タブレット（指で操作する画面）はバーが出ないので、上のバーも出さない（CSS .tbl-topbar）。
 *
 * 元＝bekidoritsu-app の ScrollWrap.tsx（boxClassName は SBC加工予定アプリで足したもの）。2026-10-28 このアプリに入れた。
 * boxClassName：スクロールする箱そのもの（.tbl-wrap）に枠・背景・高さを付けたいとき用。
 */
export default function ScrollWrap({
  className = "",
  boxClassName = "",
  children,
}: {
  className?: string;
  boxClassName?: string;
  children: ReactNode;
}) {
  const top = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0); // 横に送れる量（px）。はみ出していなければ 0＝上のバーを出さない

  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const over = el.scrollWidth - el.clientWidth;
    const nw = over > 1 ? over : 0;
    setW((cur) => (cur === nw ? cur : nw));
  }, []);

  // 測り直す時：①中身が描き直されたあと（期間や絞り込みで列が増減）②箱・表の大きさが変わったとき ③画面の幅が変わったとき
  useEffect(() => {
    const t = setTimeout(measure, 0);
    return () => clearTimeout(t);
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // 上のバーが出たら、表の今の位置に合わせる
  useEffect(() => {
    if (w > 0 && top.current && box.current) top.current.scrollLeft = box.current.scrollLeft;
  }, [w]);

  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };

  return (
    <div className={className}>
      {w > 0 && (
        <div ref={top} className="tbl-topbar" onScroll={() => sync(top.current, box.current)} aria-hidden>
          {/* 上のバーの送れる量を表とそろえる（枠や縦のスクロールバーの分で幅が少し違うため、幅でなく送れる量で合わせる） */}
          <div style={{ width: `calc(100% + ${w}px)`, height: 1 }} />
        </div>
      )}
      <div ref={box} className={`tbl-wrap ${boxClassName}`} onScroll={() => sync(box.current, top.current)}>
        {children}
      </div>
    </div>
  );
}
