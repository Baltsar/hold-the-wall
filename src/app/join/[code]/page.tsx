import { Phone } from "@/components/phone";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <Phone code={code.toUpperCase()} />;
}
