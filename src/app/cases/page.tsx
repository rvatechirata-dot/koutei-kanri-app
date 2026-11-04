import { Suspense } from "react";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import CaseView from "@/components/cases/CaseView";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return <p className="py-8 text-base">案件を直せるのは管理者だけです。</p>;
  return (
    <Suspense>
      <CaseView />
    </Suspense>
  );
}
