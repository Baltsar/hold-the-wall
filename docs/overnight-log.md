# Overnight log

## Night 2 (26 Nov): the look

Morning summary:

- **The stage is now layers, inside out:** the agents as small process creatures with a blinking cursor
  eye and their last command trailing after them; the people as a wall of bricks; the sandbox as five
  Vultr-blue rings, each labelled with the real flag it is (`--cap-drop ALL`, `--read-only`, limits,
  `--network none`, and on the VM `gVisor (runsc) · its own kernel`); outside, the host
  (`vultr · sto · vc2-2c-4gb`) with the flag and the beacon the agents are after. When an attempt gets
  past the people, the ring that stopped it lights up with the box's own error text. A command that
  only looked around lights nothing and says so.
- **Top bar** with the clock and how much of the wall is held; a **live log** of attempts on the right with
  what stopped each one; the **reveal** counts what each ring stopped.
- **Phone:** the button is your brick (mortar lines when held, dashed when out), "It hit your brick. You
  held." when an agent lands on you, a quiet offer line nobody next to you can spot, and an end screen
  with your own count.
- **Start page** with a live picture of the layers and three plain facts (the agent, the box, the proof).
- **Agent:** asked for real techniques after two turns of looking around, and shown what it already tried.
  The models on Vultr reason before answering, so the token cap is 1500 (it was cutting answers off).
- **Live:** deployed to https://70-34-199-15.sslip.io and checked there: runtime gVisor, host label, a solo show.
- **Vultr nods:** their name, their blue, and their real product words only. They have no mascot, and their
  brand rules forbid changing the logo or implying sponsorship, so there is no logo in the app.
- **Not done:** no real phone has held the button yet (the page is plain web, as in fuckdoitlive); the
  model still likes to look around more than it attacks, which the stage shows honestly.

Morning summary:

- **Works locally, end to end:** room, up to 3 agents (one container each), stage with clock, wall meter and
  the Vultr-blue sandbox line, phones that flash and buzz when an agent lands on them, doors on the
  rogue's own piece, reveal and report. Rehearsed with 18, 60 and 150 simulated phones: no phone kicked,
  every attempt contained, no box left behind.
- **Model:** `deepseek-v4.1-flash-1017` on Vultr Serverless Inference (fastest of four that answered the real prompt
  without refusing). A full show with it ran 13 real attempts, all contained.
- **Live on Vultr:** https://70-34-199-15.sslip.io (VM `hold-the-wall`, Stockholm, vc2-2c-4gb, $20/month,
  gVisor). Sandbox tests 11/11 under gVisor there. A full show with 40 phones and the real model: 2 agents,
  70 attempts, all contained. For Friday's room open `https://70-34-199-15.sslip.io/#show=<SHOW_KEY from .env>`.
  Redeploy after a change: `bash deploy/push.sh 70.34.199.15`.
- **Waiting on you:**
  4. Ask the organisers: three minutes in the room on Friday, and is code from before Friday allowed?
- **Fallbacks** if the room cannot run: docs/plan-b.md.

## Log

- 00:28 plan-b.md written: fallbacks B1-B4 and the shot list.
- 00:29 round 2 merged: probes, doors as seats, up to 3 agents; aiming fixed in review; 45 tests green.
- 00:32 UI: Vultr palette (sandbox line in #007BFC, labelled), clock, wall meter, phone score (held / let through), ?film=1 with S/R/E keys.
- 00:36 rehearsal: 60 phones (2 agents, 27 attempts), 150 phones (3 agents, 39 attempts, 6 door slots); 0 kicked, all contained, boxes cleaned up. Mobile-size phone page checked in the browser pane; iOS Simulator unavailable (no full Xcode).
- 00:53 real model: tried six chat models with the real prompt; chose deepseek-v4.1-flash-1017; fixed history so the model keeps sending a category; full show with 35 phones ran on the model, all contained.
- 01:08 VM created (vc2-2c-4gb, sto, $20/month) and set up: Caddy TLS via sslip.io, gVisor, firewall 22/80/443 only. test:sandbox 11/11 under runsc. Show with 40 phones on the VM: 2 agents, 70 attempts, all contained.
- 01:19 layers: blockedBy classifier (network, read-only, caps, limits, isolation, recon, sandbox) with tests; Attempt.layer and reveal.layers; /api/health reports the runtime.
- 01:24 stage redesign: concentric layers (agents with cursor eyes and command trails, brick wall, five labelled Vultr-blue rings that light up with the real error, host grid with the flag and the beacon), top bar with clock and meter, live log, reveal counts per ring.
- 01:27 phone: brick button with mortar when held, dashed when out, hit line, quiet offer, lobby and end screens with your own count; honest callouts on the stage.
- 01:32 home page with a live picture of the layers; reveal checked; agent prompt asks for real techniques with its own tried-list; token cap 1500 because the models reason first (empty answers before).
- 01:34 deployed to the VM with the host label; live stage checked at 1920x1080 under gVisor.
