"use client";

/**
 * 上のメニュー（2026-11-24 川﨑部長「今どこの画面を開いているか分かりやすく。出来高管理のアプリみたいに」）。
 * 出来高アプリ（dekidaka-app の Nav.tsx）と同じ形：濃い色の帯に、今開いている画面のタブだけ明るい地＋太字。
 * 管理者向けの画面（CSV取り込み・案件・基本の一覧・操作ログ）は「管理」にまとめ、開いている間だけ2段目にタブを出す。
 * 帯は画面を下へ動かしても上に残る。幅が足りないときは横に動かせる（折り返さない）。
 */
import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

type Sub = { href: string; label: string };
type Item = { href: string; label: string; sub?: Sub[]; admin?: boolean };

const ITEMS: Item[] = [
  { href: "/board", label: "工程一覧" },
  { href: "/orders", label: "受注一覧" },
  { href: "/lanes", label: "ボード" },
  { href: "/ship", label: "出荷" },
  { href: "/stock", label: "在庫" },
  { href: "/gantt", label: "ガント" },
  { href: "/summary", label: "集計" },
  {
    href: "/import",
    label: "管理",
    admin: true,
    sub: [
      { href: "/import", label: "CSV取り込み" },
      { href: "/cases", label: "案件" },
      { href: "/master", label: "基本の一覧" },
      { href: "/logs", label: "操作ログ" },
    ],
  },
];

const on = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

export default function Nav({ admin, userLabel }: { admin: boolean; userLabel: string }) {
  const pathname = usePathname();
  const list = ITEMS.filter((it) => admin || !it.admin);
  const activeOf = (it: Item) => (it.sub ? it.sub.some((s) => on(pathname, s.href)) : on(pathname, it.href));
  const openSub = list.find((it) => it.sub && activeOf(it))?.sub;
  // スマホなど幅が狭いとき、今の画面のタブが帯の外に隠れないよう、見える所まで帯を動かす
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>("[aria-current=page]").forEach((el) => {
      const box = el.parentElement;
      if (!box || box.scrollWidth <= box.clientWidth) return;
      const r = el.getBoundingClientRect();
      const bx = box.getBoundingClientRect();
      box.scrollLeft += r.left - bx.left - (bx.width - r.width) / 2;
    });
  }, [pathname]);
  return (
    <nav ref={ref} className="sticky top-0 z-40 bg-slate-800 text-white shadow" aria-label="メニュー">
      <div className="mx-auto flex max-w-[96rem] items-center gap-1 overflow-x-auto px-4">
        <Link href="/board" className="mr-2 shrink-0 py-3 text-lg font-bold tracking-wide whitespace-nowrap">
          工程管理
        </Link>
        {list.map((it) => {
          const active = activeOf(it);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 shrink-0 items-center rounded-md px-3 text-base whitespace-nowrap ${
                active ? "bg-white font-bold text-slate-900" : "text-slate-100 hover:bg-slate-600"
              }`}
            >
              {it.label}
            </Link>
          );
        })}
        <span className="ml-auto shrink-0 pl-4 text-sm whitespace-nowrap text-slate-200">{userLabel}</span>
      </div>
      {openSub && (
        <div className="bg-slate-600">
          <div className="mx-auto flex max-w-[96rem] items-center gap-1 overflow-x-auto px-4 py-1">
            {openSub.map((s) => {
              const active = on(pathname, s.href);
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 shrink-0 items-center rounded-md px-3 text-base whitespace-nowrap ${
                    active ? "bg-white font-bold text-slate-900" : "text-white hover:bg-slate-500"
                  }`}
                >
                  {s.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
