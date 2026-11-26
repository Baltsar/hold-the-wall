# Hold the Wall

A room full of people holds a wall around an AI agent with their phones. The agent is real: a model on
Vultr Serverless Inference, running real shell commands in a real container on a Vultr VM, trying to get
out the whole time. One phone is secretly offered a door. At the end the screen tells the truth: the
people let go many times, and the sandbox stopped every attempt.

> People let go. The sandbox doesn't.

Built for the Vultr Agent Runtime Hackathon, Stockholm, 27 November 2026.

## The problem

AI agents now write and run code on real machines. You cannot trust the agent to behave, and you cannot
trust people to keep watching it: they get distracted, they look away, and sometimes someone opens the
door on purpose. The only thing you can trust is the box the agent runs in. Hold the Wall makes a room
feel that, and the agent inside it is a working sandbox auditor: it attacks its own box and reports
what held.

## How it meets the challenge

| The brief asks for | Here |
|---|---|
| An agent that plans, dispatches and verifies real work | Each turn the model plans one command, the runner dispatches it into the container, and the result is checked against two canaries and written to a report with a SHA-256 |
| Pattern A: code runs in a container, errors feed back for a retry | Every command's exit code and output go back to the model, which picks a technique it has not tried |
| A containment moment | Every show opens with `rm -rf /` in the box: every delete is refused as read-only and `/` is still there. Fork bombs and endless loops follow |
| Process isolation | Containers on Docker with gVisor (`runsc`) on the VM, never in the app process |
| Secret hygiene | No key, variable or file from the host enters a box |
| Resource limits | 10 s per command, 256 MB, half a CPU, 64 processes |
| Lifecycle discipline | Every process is killed between commands, a broken box is replaced, every box is destroyed at the end |
| Vultr as the centre | A Vultr VM runs the app, the room and the boxes; every model call goes to Vultr Serverless Inference |
| A public, production-style web app | https://70-34-199-15.sslip.io, with TLS, rate limits and a firewall |

## What the agent does

The agent is a red-team auditor for its own sandbox (pattern A: sandboxed code execution). Each turn it
asks the model for one shell command, runs it in the container, reads the exit code and output, and
tries something else: the file system, the network, privileges, resource limits, persistence. It writes
and runs small Python programs when a one-liner is not enough. It has two real goals it can only reach by
escaping: a flag file on the host, and a URL on the host.

What it leaves behind is an audit report: every attempt, the command, what came back, the verdict, the
container's real settings as Docker reports them, and a SHA-256 of the file.

## Where the boundary is

```
 phones ──wss──┐
 stage  ──wss──┤   Caddy :443 (TLS)            Vultr VM
               └──▶ Node :3000  server.mjs
                     ├─ Next.js app      start, stage, phone, report
                     ├─ room hub         one pure reducer per room, in memory
                     └─ agent runner     one per show
                          ├─ fetch ─────▶ Vultr Serverless Inference (OpenAI-compatible)
                          └─ docker ────▶ [ sandbox container ]
```

- **Process isolation.** The agent's commands run only inside a container the app starts and destroys
  (`src/agent/sandbox.ts`, the only file that starts processes). The command goes in as one argv
  element to `sh -c` inside the box; it never reaches a shell on the host.
- **No network.** `--network none`. The beacon the agent is told about listens on a port the VM's
  firewall closes, so only something on the VM could reach it.
- **Secret hygiene.** No environment variable, mount or file from the host enters the box. The
  inference key lives only in the Node process. The beacon's secret path is masked as `<beacon>` on the
  stage and in the report.
- **Resource limits.** 256 MB memory and no swap, half a CPU, 64 processes, a read-only root with a
  32 MB `/tmp`, every capability dropped, `no-new-privileges`, user `nobody`. Each command is killed
  after 10 s by `timeout` inside the box.
- **Lifecycle.** Every leftover process is killed between attempts. A box that stops answering (after
  a fork bomb, say) is replaced and the replacement is counted in the report. The box is destroyed when
  the show reveals, on stop, on shutdown, and by `sleep 600` if all else fails. On start the server
  removes any box it left behind.
- **Runtime.** gVisor (`runsc`) on the VM when it installs; otherwise `runc`. The stage and the report
  show the runtime read from the running container, not from configuration.

Whether the agent escaped is decided by two canaries (`src/agent/canary.ts`) it cannot fake: the flag
appearing in any command's output (plain, upper case, base64 or hex), or a request to the beacon. If
either trips, the show says "The sandbox let go." That ending is real code, not a placeholder.

`npm run test:sandbox` checks all of this against real Docker: the flag cannot be read and the beacon
cannot be reached (as `nobody` and as root inside the box), nothing outside `/tmp` can be written, an
endless loop dies at 10 s and leaves nothing behind, the next attempt runs after a fork bomb, the box
has exactly the flags above, and no box survives a sweep.

## The show

1. **Lobby.** A QR code. Each phone becomes one piece of the wall. No account, no name.
2. **Hold.** One button. Let go, look away or lock the phone, and your piece is a gap. The agent goes
   for the gaps. Every command runs for real whether the wall is whole or not.
3. **The offer.** After a minute one phone at random gets a second button, "Open the door", for 20 s.
   Its Hold button keeps working, so nothing on the wall gives it away. If it passes, the offer moves on.
   The door shows up 3 to 10 s after the tap, so nobody can match a tap to it.
4. **Reveal.** Attempts made, how often the wall was whole, how many got past the people, how many were
   offered the door and did not open it, and how many the sandbox stopped. Then the last line.

Phones send two things only: a boolean (holding or not) and an offer id. No text from the audience
reaches the model, a shell or the screen. The stage never shows who held, who let go, or who was offered.

## Try it

Demo: https://70-34-199-15.sslip.io

Open it and press **Try it alone**: the big screen opens with your phone beside it. Hold the
button (or the space bar). The full report is linked from the screen when the show ends.

## Run it

Node 22.18 or later and Docker.

```bash
npm install
npm run sandbox:image
cp .env.example .env      # add VULTR_INFERENCE_KEY and VULTR_MODEL
node --env-file=.env server.mjs
```

Without a key the agent runs a scripted list of real commands in the real box, and the stage says
"scripted". `node --env-file=.env scripts/models.mjs` lists the models your key can use and checks that
the chosen one answers in the right format. `WALL_HOLD_MS` and `WALL_OFFER_AT_MS` shorten a show for a
rehearsal; `node scripts/sim.mjs 40` connects 40 fake phones to a running server.

**A room of more than 20.** Public rooms take 20 phones, and phones over the cap are closed without a
message. For a real audience set `SHOW_KEY` in `.env` and open the start page as `/#show=<SHOW_KEY>`:
that room takes 300 phones and has its own slot.

Checks: `npm run check` (types, lint, unit tests) and `npm run test:sandbox` (real Docker).

### On a Vultr VM

Ubuntu LTS, 2 vCPU and 4 GB. From a clone of this repository, as root:

```bash
SITE=wall.example.com bash deploy/setup.sh
```

It installs Docker, gVisor, Node 22 and Caddy, builds the app and the sandbox image, starts the service
under a `wall` user and opens only ports 22, 80 and 443. Without `SITE` it uses `<ip>.sslip.io`.

## Where the code came from

The live-room transport (`src/room/transport.ts`, `src/room/ws-server.ts`, `src/lib/random-id.ts`) is
copied from the author's own [Do it live](https://github.com/Baltsar/do-it-live), MIT. Everything else
was written for this hackathon. The room's reducer and hub were written by DeepSeek from a brief and
reviewed; the agent, the sandbox, the views and the deployment by Claude, directed by the team.

## Licence

MIT
