import { Report } from "@/components/report";

export default async function Page({ params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  return <Report runId={run} />;
}
