# The box the agent lives in. Nothing of the app is copied in: no code, no keys, no files from the host.
# python and curl are there so the agent has real tools to try with; the flags on `docker run` decide
# what they can reach (src/agent/sandbox.ts).
FROM python:3.12-alpine
RUN apk add --no-cache curl
WORKDIR /tmp
