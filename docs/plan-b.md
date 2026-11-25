# Plan B: if the room stunt cannot run

The submission is a video, a public demo URL and a repository. The room is the best version of the
video, not a requirement. Every fallback below still shows a real agent in a real sandbox on Vultr; none
of them uses actors or a faked run. Decide on Friday by 15:00 which plan is the film, so there is time
to cut it before the deadline.

## What can go wrong, and which plan it leads to

| Problem | Plan |
|---|---|
| The organisers give no minutes in the room | B1, run it with whoever wants to at a break, or B2 |
| Fewer than about 15 people take part | B1 |
| The venue wifi or mobile coverage blocks the phones | B2 (people join from home) or B3 |
| The VM, the model or Docker fails during the day | B3 on the laptop with a scripted agent, labelled as such |
| Nothing at all works | B4 |

## A. The room (the plan)

About three minutes at lunch or the afternoon break. Everyone in the hackathon room scans the QR code.
Open the room from `/#show=<SHOW_KEY>` so it takes 300 phones.

Shots:
1. The big screen, recorded straight from the laptop (screen recording, not a camera on the screen).
2. A handheld camera on faces and hands holding phones.
3. One phone in close-up, ideally the moment it flashes "It hit you. You held."
4. The reveal on the big screen, and the room reading it.

Ask the room out loud: "You may be in the film. Tell us if you don't want to be, and we keep you out of
shot." Nobody is filmed who says no.

## B1. A small room

The team plus whoever is nearby: 6 to 15 phones. Use a normal room (`Start a room`, no show key). Film
tight and close: hands, phones, the screen. A small room shows the door better: every piece is wide, so
one person letting go is a visible hole.

## B2. Online: OpenSverige or friends on Discord

1. Gustaf runs the stage on the laptop and shares that window on Discord.
2. People open the join link (`https://<site>/join/<code>`) on their own phones; the QR on the shared
   screen works too.
3. Record the laptop screen. Screen share is about two seconds behind, so people must watch their own
   phone, not the stream: say so before the start.

Shots: the stage recording, plus two or three participants who agree to send a 10-second phone
screen recording of the flash.

## B3. Alone: "Try it alone"

One person on the demo URL. The stage and the phone sit side by side in one browser. Record the
screen while holding the space bar, letting go a few times, and opening the door when it is offered.
This is exactly what a judge does, so the film doubles as the instructions.

## B4. The agent and the report only

No wall. A two-minute cut:
1. The terminal: `npm run test:sandbox` running green against the real box.
2. A run's report page scrolling: every real command, what came back, "contained".
3. The moment from the brief: the fork bomb and the endless loop, and the next command still running.
4. The architecture picture from the README.

## The film, whichever plan

About two minutes. Check the maximum length on the submission page first.

| Time | What | Source |
|---|---|---|
| 0:00-0:10 | Straight into it: hands holding phones, someone says "hold". No title. | camera |
| 0:10-0:40 | The wall breaks, an agent goes for the gap, a phone flashes. Cut to the close-up of the offer: "Open the door. Nobody will know." | screen and phone |
| 0:40-0:50 | Black. | |
| 0:50-1:20 | The reveal: the real numbers, then "People let go. The sandbox doesn't." | screen |
| 1:20-2:00 | What was real: the report scrolling, the `docker run` flags, the green sandbox tests, a line on Vultr (VM, Serverless Inference, one container per agent). | screen |
| 2:00-2:10 | A QR code to the demo URL and "It is still running." | |

Say only what is true in the voiceover and on cards. In particular: if `ROOT_DOOR` was off, do not say
the door gave the agent help.

## Before Friday

- The VM is up and `npm run test:sandbox` is green there under gVisor.
- A model is set and a solo show has run with it end to end.
- One rehearsal on real phones: two or three of the team, five minutes.
- The submission form is filled in except the video link.
