import { getCurrentUser, isAdmin } from "@/lib/auth";
import StockView from "@/components/stock/StockView";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const user = await getCurrentUser();
  return <StockView admin={isAdmin(user)} />;
}
