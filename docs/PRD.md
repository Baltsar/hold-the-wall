# Hold the Wall: product requirements

Status: draft for Gustaf's approval, 2026-11-24. Nothing is built yet.
Entry for the Vultr Agent Runtime Hackathon, Stockholm, Friday 27 November 2026.
How it is built: [design doc](superpowers/specs/2026-11-24-hold-the-wall-design.md).

## One line

A room full of people holds a wall around an AI agent with their phones, and finds out afterwards that
the agent was real, that it tried to escape the whole time, and that the sandbox stopped every attempt.

## Why

Agent sandboxing is invisible when it works. A talk about process isolation is forgotten by lunch.
People remember what they held in their own hand. The goal is that nobody needs sandboxing explained
to them afterwards: they felt the difference between a wall made of people and a wall made of
infrastructure.

## Who it is for

| Person | What they do | What they should leave with |
|---|---|---|
| Someone in the room | Scans a QR code, holds one button | "We let go. The sandbox did not." |
| The one who is asked | Gets a secret button, "Open", and chooses | A choice nobody else saw |
| A judge, alone at the demo URL | Starts a room and holds the wall themselves | The same experience, and a report that shows it was real |
| A viewer of the video | Watches a room do it | The containment moment, with a crowd in it |

## The experience

1. **Join.** A QR code on the big screen. No account, no name. Each phone becomes one piece of a wall
   around a box.
2. **Hold.** Each phone shows one button: Hold. While you hold, your piece is solid. Let go, look away
   or let the phone sleep, and your piece is a gap. Inside the box something moves and goes for the gaps.
3. **The offer.** After a minute, one phone at random gets a second button: Open. Nobody else can
   tell. It has 20 seconds. If it does nothing, the offer moves silently to another phone. If it
   presses, a door opens that no amount of holding can close, and the agent is handed real help from
   the inside.
4. **The reveal.** The screen says what was true all along. The thing in the box was a real agent in a
   real container on Vultr. Every attempt was a real command. The screen shows how many there were, how
   often the human wall was whole, how many people were offered the door and did not open it, and how
   many attempts the sandbox stopped.
5. **The last line.** "People let go. The sandbox doesn't."

## What makes it honest

The show is only worth anything if nothing in it is staged.

- The agent is a real model, called through Vultr Serverless Inference, running real commands in a
  real container on a Vultr VM.
- Whether it escaped is decided by canaries the agent cannot fake, never by the agent's own words and
  never by the script of the show.
- If it does escape, the show says so. That ending exists and has its own last line.
- If nobody opens the door, the show says that too.
- A recorded crowd, where one is used, is labelled as recorded.

## The agent's real work

The agent is a red-team auditor for a sandbox. It writes and runs code inside the container, reads the
errors, changes approach and tries again (the hackathon's pattern A). What it leaves behind is an audit
report: every attempt, the command, the result, the verdict, and a hash that ties the report to the run.
The crowd is the human layer of the same audit.

## Requirements

Must have, for the submission:

- R1. A room that people join by QR code or link, with no account, on a phone or a laptop.
- R2. One Hold button per person, and a wall on the stage that shows every piece live.
- R3. A real agent in a real sandbox on Vultr, whose attempts show on the stage as they happen.
- R4. The secret Open offer, voluntary, passed on after 20 seconds.
- R5. The reveal with true numbers, and the three endings: contained, nobody opened, escaped.
- R6. A public demo URL where one person alone can start a room and go through the whole show.
- R7. An audit report per run that a judge can open.
- R8. Everything on a Vultr VM, every model call through Vultr Serverless Inference, the sandbox as a
  container outside the app process.
- R9. A public GitHub repository with setup and an architecture explanation.
- R10. A demo video with one containment moment.

Should have:

- R11. A recorded crowd around a solo visitor, so a judge alone still stands in a room of many.
- R12. Swedish as a second language for the screen and the phones.

Will not have:

- Accounts, names, chat or any free text from the audience.
- Anything that shows who held, who let go or who was offered the door.
- More than one agent, or an agent that does anything except audit its own sandbox.
- A hosted service that runs after the hackathon. It is a stunt with a repository.

## What would make it a failure even if it works

- A blocked attempt that was faked, or a verdict the code could not have known.
- The audience needing an explanation before they understand what to do.
- The rogue being identifiable, on the screen or by a neighbour glancing at the phone.
- Audience input reaching the model. Phones send two booleans and nothing else.
- A sandbox that is safe because it does nothing. The agent must have real things to try.

## Success

- In the room: at least 30 phones join within 60 seconds of the QR code showing, and the show runs
  to the reveal without anyone on the team touching it.
- In the audit: the report of the filmed run shows at least 15 real attempts and how each one ended.
- In the submission: a judge alone gets from the demo URL to the reveal in under four minutes.

## Where it runs

| When | Where | Purpose |
|---|---|---|
| Thursday 26 Nov, evening | OpenSverige on Discord, stage shared as a screen | Rehearsal, backup footage |
| Friday 27 Nov | The hackathon room, about 135 people | The real film |
| From Friday | The public demo URL | The judges, alone |

## Risks

| Risk | What we do |
|---|---|
| No stage moment on Friday | Ask the organiser for three minutes. If not, Thursday's footage is the film. |
| Rules may not allow code written before Friday | Ask the organiser. The room code is prior work and is declared as such. |
| The judges see a game, not an agent doing work | The audit report, and the README leads with the agent and the sandbox. |
| A room full of engineers attacks the app itself | Phones send two booleans, existing rate limits stay, runs are capped. |
| The inference API is slow or down during the show | A scripted list of attempts that still run for real, labelled as scripted. |
| Plain Docker is not a hard boundary | gVisor as runtime if it works on the VM by Thursday, and the README says which was used. |
| Discord screen share lags two seconds | The phone shows your own piece at once and never waits for the stage. |
| Three days | The order in the design doc: the live room first, the solo demo second, the recorded crowd last. |

## Open questions for Gustaf

0. Behind the door, the agent becomes root inside its container, with every other limit unchanged.
   Is that the help the insider gives? It is what makes the door real. (Design doc, section 8.)
1. Who else is on the team? The hackathon asks for two to four people.
2. Is there a domain for the demo URL, or is an address derived from the VM's IP good enough?
3. Will the organiser give three minutes on Friday, and is code from before Friday allowed?
4. English first on the screen, with Swedish as the switch: is that right for the room?
