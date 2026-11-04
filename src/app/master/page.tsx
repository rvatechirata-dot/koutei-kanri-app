import { getCurrentUser, isAdmin } from "@/lib/auth";
import MasterView from "@/components/master/MasterView";

export const dynamic = "force-dynamic";

export default async function MasterPage() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return <p className="py-8 text-base">基本の一覧を直せるのは管理者だけです。</p>;
  return <MasterView />;
}
