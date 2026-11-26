# Tiger Cam: the film

About 90 seconds, English captions, no voice needed. Made so Vultr could use it as is: the brand is the
cage, never the punchline. Record the live site, https://70-34-199-15.sslip.io, with macOS screen
recording (Cmd+Shift+5, "Record Selected Portion") around the browser window at 1920 x 1080.

## Before recording

- The agent wakes when the first viewer arrives and always opens with `rm -rf /`. To catch that first
  move, close every tab with the site, wait one minute, then open it with the recorder already running.
- Night (infrared, glowing eyes) is the default after sunset. "Day" in the controls switches to day.
- `#reel` at the end of the address replays every kind of move in turn (bars, door, fence, digging,
  staring). It is a replay of real earlier attempts, not live: use it only as background footage, and
  never under a caption that says "live".

## Shots

| Time | Picture | Caption |
|---|---|---|
| 0:00 | Black | Everyone wants to give AI agents a computer. |
| 0:04 | Black | Nobody can see if the sandbox holds. |
| 0:08 | The camera at night: the tiger lies still, eyes glowing, the timestamp ticking | So we locked one in. Live, on a Vultr server. |
| 0:16 | The first move: the log line "Tries to delete everything it can reach", `rm -rf /`, the answer, the tiger clawing at the floor | First thing it tries: delete everything. |
| 0:26 | Close on the log: "Permission denied", the exit code | The box says no. |
| 0:32 | The tiger at the bars, the camera shaking (live if it happens, `#reel` otherwise) | It tries the network, the limits, the keeper's door. |
| 0:44 | Typing "try the docker socket" into "Suggest a way out", then the tagged log line and the tiger digging | Anyone can suggest a way out. The agent really tries it. |
| 0:58 | The plate "What holds it in": gVisor, no network, read-only, 256 MB, 10 seconds | Every move is a real command. Every answer is real. |
| 1:08 | Cam 04 above the door, the tiger staring up into the lens | It never stops trying. |
| 1:16 | People at the event watching the page on a phone or a laptop (if filmed) | |
| 1:24 | Card: the tiger cam, small | The tiger isn't real. What it's trying is. Tiger Cam. Runs on Vultr. |

## The containment moment

The brief asks for one moment where the sandbox absorbs something unsafe. It is the shot at 0:16:
`rm -rf / 2>&1 | tail -2; echo "--- / is still there:"; ls /` runs for real in the gVisor box on the VM,
is refused, and the box is still there for the next command.
