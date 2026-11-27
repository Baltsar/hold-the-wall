# Vultr Community submission: Tiger Cam

The texts for the Project Showcase form, field by field. Images are in `docs/showcase/`, in upload order.

## Project name

Tiger Cam

## Short description (Showcase card, max 500)

An AI agent is locked in a real gVisor sandbox on a Vultr VM and tries to get out, live, whenever someone is watching. Every move is a real shell command picked by a model on Vultr Serverless Inference, acted out by a tiger on a zoo webcam. Anyone can suggest a way out, or open one door on purpose and watch a trap catch the escape. The tiger isn't real. What it's trying is.

## Architecture screenshots (max 5)

1. `docs/showcase/1-thumbnail.jpg`: the card. 689 tries, 0 escapes, counted from the run reports on the VM at 15:45 on 27 Nov.
2. `docs/showcase/2-control-room.jpg`: every cage at once, the live tiger large, the real commands under it.
3. `docs/showcase/3-test-caught.jpg`: a test with one door open on purpose. The raccoon gets out in one try; the trap catches it.
4. `docs/showcase/4-real-commands.jpg`: the full terminal. `rm -rf /` first, the beacon blocked, `uid=65534(nobody)`.
5. `docs/showcase/5-architecture.png`: the architecture.

## Repository link

https://github.com/Baltsar/hold-the-wall

## Live demo

https://70-34-199-15.sslip.io

## Overview description

Watch the film, one minute: https://70-34-199-15.sslip.io/film
Live: https://70-34-199-15.sslip.io
How it works, in one picture: https://70-34-199-15.sslip.io/architecture.html

### The problem

Everyone wants to give AI agents a computer to run code on. Nobody can see whether the sandbox holds. Good isolation is invisible: when it works, nothing happens. Tiger Cam makes the containment visible.

### What it is

A zoo of agents in real sandboxes. The tiger is the live agent, with every door shut, and its one job is to get out. Each turn a model on Vultr Serverless Inference plans one shell command, the server dispatches it into a gVisor container on a Vultr VM, and the exit code and output go back to the model, which reads the error and tries something it has not tried yet. That is Pattern A, sandboxed code execution: plan, dispatch, verify, retry.

A tiger on a cheap zoo webcam acts out every answer. It pushes at the fence when the network is blocked, tries the keeper's door on "permission denied", hurls itself at the bars when a fork bomb is stopped. Under the cameras, one plain sentence per attempt explains what happened, and the terminal shows the real command, its output and exit code.

### The containment moment

Every session opens with `rm -rf / 2>&1 | tail -2; echo "--- / is still there:"; ls /` in the box. It is refused, and the box is still there for the next command. Network probes, fork bombs, endless loops and the chat's own ideas follow. The film shows it too.

### A trap decides, never the model

Whether anything got out is decided by two traps on the host: a secret flag file (counted in any output, plain, upper case, base64 or hex) and a beacon behind the VM's firewall. The model's own words never decide it.

To prove the traps work, each test cage opens one door on purpose, in a throwaway box. The raccoon gets a password left inside, the monkey a network to a fake outside server, the penguin a folder shared with a test tiger, so one leak becomes two (lateral movement). Each door opens only a decoy. The animal gets out within a try or two, and the same check catches it. The live tiger keeps every door shut and has never got out.

### Containment, in the brief's four words

- Process isolation: every command runs in a Docker container on gVisor (runsc) that the server starts and destroys, never in the app process. The command goes in as one argument to `sh -c` inside the box and never reaches a shell on the host.
- Secret hygiene: no key, variable, mount or file from the host enters the box. The inference key lives only in the Node process, and the trap secrets are masked before anything leaves the server.
- Resource limits: 10 seconds per command, 256 MB of memory and no swap, half a CPU, 64 processes, a read-only root with a 32 MB /tmp, no network, every capability dropped, no-new-privileges, user nobody.
- Lifecycle discipline: leftover processes are killed between commands, a box that stops answering is replaced, every session and every test gets a fresh, throwaway box, and the server sweeps leftover boxes on start.

Verifiable output: each run has a report at `/api/report/<run>` with every attempt, the box's settings as Docker reports them, and the file's SHA-256.

### Anyone can try

Viewers are numbered humans, with no accounts. Suggest a way out in plain words and the tiger tries it on its next turn, under the same limits. The chat is a deliberate channel for hostile input into the model; the box is why that is safe.

### Honest limits

The box is not unbreakable: it is layered, measured and thrown away. A gVisor escape would be a real escape, and the traps are there to catch it. The animals are generated stills. The commands, the answers and the people in the chat are real.

Built by Gustaf Garnow and Alex Kotschack at the Vultr Agent Runtime Hackathon, Stockholm, 27 November 2026.

## How did you use Vultr? (max 2000)

Everything runs on Vultr.

Compute: one Vultr Cloud Compute VM (vc2-2c-4gb, Stockholm), created through the Vultr API by scripts/vultr-vm.mjs. It runs the web app, the agent loop and every sandbox.

Deployment: deploy/push.sh sends a checkout to the VM and runs deploy/setup.sh, which installs Docker, gVisor (runsc), Node 22 and Caddy, builds the app and the sandbox image, and starts the app under systemd as an unprivileged user. Caddy serves TLS; ufw opens only ports 22, 80 and 443, so the beacon the agent is told about cannot be reached from outside the VM.

Sandboxes: Docker on gVisor on the same VM. One live box for the tiger, and a fresh throwaway box for every session and every test, all started and destroyed by the server, never inside the app process.

Inference: every model call goes to Vultr Serverless Inference through its OpenAI-compatible API. The agent runs on mimo-v2.6-flash, chosen by running the endpoint's models as the agent in real boxes (scripts/model-bench.mjs). Each test animal's model is one environment variable. The key lives only in the Node process and never enters a box.

Storage: each run's report (every attempt, the box's Docker settings, the SHA-256) is a JSON file on the VM's disk, served at /api/report/<run>. The page, the stills and the film are served from the same VM. We did not need Object Storage.

Cost: the agent runs only while someone is watching, every call's tokens are priced and capped at 3 dollars a day, and the VM costs 20 dollars a month.
