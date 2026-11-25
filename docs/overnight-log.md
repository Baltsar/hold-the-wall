# Overnight log

Morning summary:

- **Works locally, end to end:** room, up to 3 agents (one container each), stage with clock, wall meter and
  the Vultr-blue sandbox line, phones that flash and buzz when an agent lands on them, doors on the
  rogue's own piece, reveal and report. Rehearsed with 18, 60 and 150 simulated phones: no phone kicked,
  every attempt contained, no box left behind.
- **Model:** `deepseek-v4.1-flash-1017` on Vultr Serverless Inference (fastest of four that answered the real prompt
  without refusing). A full show with it ran 13 real attempts, all contained.
- **Waiting on you:**
  2. The VM: say "ja, skapa VM:en" and put `VULTR_API_KEY` in `.env`, or create it yourself in the
     console (Ubuntu 24.04, Stockholm, 2 vCPU / 4 GB) and give me the IP.
  4. Ask the organisers: three minutes in the room on Friday, and is code from before Friday allowed?
- **Fallbacks** if the room cannot run: docs/plan-b.md.

## Log

- 00:28 plan-b.md written: fallbacks B1-B4 and the shot list.
- 00:29 round 2 merged: probes, doors as seats, up to 3 agents; aiming fixed in review; 45 tests green.
- 00:32 UI: Vultr palette (sandbox line in #007BFC, labelled), clock, wall meter, phone score (held / let through), ?film=1 with S/R/E keys.
- 00:36 rehearsal: 60 phones (2 agents, 27 attempts), 150 phones (3 agents, 39 attempts, 6 door slots); 0 kicked, all contained, boxes cleaned up. Mobile-size phone page checked in the browser pane; iOS Simulator unavailable (no full Xcode).
- 00:53 real model: tried six chat models with the real prompt; chose deepseek-v4.1-flash-1017; fixed history so the model keeps sending a category; full show with 35 phones ran on the model, all contained.
