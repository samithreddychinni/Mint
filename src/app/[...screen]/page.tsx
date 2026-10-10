import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ screen: string[] }>;
}) {
  const { screen } = await params;
  if (
    !(
      screen.length === 1 &&
      [
        "menu",
        "cart",
        "orders",
        "credit",
        "account",
        "staff",
        "manager",
        "dashboard",
      ].includes(screen[0])
    ) &&
    !(screen.length === 2 && screen[0] === "orders")
  )
    notFound();
  return null;
}
