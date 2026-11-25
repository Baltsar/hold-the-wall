import { Stage } from "@/components/stage";

export default async function Page({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ solo?: string }> }) {
  const { code } = await params;
  const { solo } = await searchParams;
  return <Stage code={code.toUpperCase()} solo={solo === "1"} />;
}
