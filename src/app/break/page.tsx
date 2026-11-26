import Link from "next/link";

const VARIANTS = [
  {
    href: "/break/missions",
    name: "Missions",
    line: "Pick a mission for the agent. Watch it bounce. Switch off one protection and watch it get out.",
    best: "Best for: understanding what each protection does",
  },
  {
    href: "/break/panel",
    name: "The control panel",
    line: "Big switches for every protection. Turn some off, press one button, see which one let it out.",
    best: "Best for: one press, one clear answer",
  },
  {
    href: "/break/insider",
    name: "The insider",
    line: "The agent asks you to help it escape, one favour at a time. You decide.",
    best: "Best for: filming reactions",
  },
];

export default function Page() {
  return (
    <main className="bx-pick">
      <p className="eyebrow">Break the box · three variants</p>
      <h1>Try to let the AI out</h1>
      <p className="lead">An AI agent is locked in a box on a Vultr server. Each variant runs the same real agent in the same real box. Try them, keep the one that works.</p>
      <div className="bx-variants">
        {VARIANTS.map((v) => (
          <Link key={v.href} href={v.href} className="bx-variant">
            <h2>{v.name}</h2>
            <p>{v.line}</p>
            <small>{v.best}</small>
          </Link>
        ))}
      </div>
      <p className="muted">
        The room version is still here: <Link href="/">Hold the Wall</Link>.
      </p>
    </main>
  );
}
