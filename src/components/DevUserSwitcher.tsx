"use client";

import { useEffect, useState } from "react";

interface UserOption {
  email: string;
  name: string;
  role: string;
}

/** 開発時のみ表示する、ログインユーザー切り替えバー（本番では描画されない） */
export default function DevUserSwitcher({ current }: { current: string }) {
  const [users, setUsers] = useState<UserOption[]>([]);

  useEffect(() => {
    fetch("/api/dev/users")
      .then((r) => (r.ok ? (r.json() as Promise<UserOption[]>) : []))
      .then(setUsers)
      .catch(() => {});
  }, []);

  async function switchTo(email: string) {
    await fetch("/api/dev/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    location.reload();
  }

  return (
    <div className="bg-amber-100 text-amber-900 text-xs px-4 py-1 flex items-center gap-2">
      <span>開発モード：ユーザー切替</span>
      <select
        className="border border-amber-300 rounded px-1 py-0.5 bg-white"
        value={current}
        onChange={(e) => switchTo(e.target.value)}
      >
        <option value={current}>{current}</option>
        {users
          .filter((u) => u.email !== current)
          .map((u) => (
            <option key={u.email} value={u.email}>
              {u.name}（{u.role}） {u.email}
            </option>
          ))}
      </select>
    </div>
  );
}
