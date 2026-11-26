# Overnight log

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
