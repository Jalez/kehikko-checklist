#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell.
#   - $PORT from the environment. Whoever starts this chose the port; a script
#     that picked its own would answer somewhere nobody is looking. 7860 is the
#     default and it is the number in the registration too — 7820, 7830, 7840 and
#     7850 belong to References, Atlas, Journeys and the orchestrator on this
#     machine.
#   - `exec`, and the foreground. A script that forks and returns leaves whoever
#     started it holding a pid that stops nothing, and Stop is only ever offered
#     for what a host started.
#   - `cd` to this script's own directory, so `bunx vite` finds this app's own
#     config and its `node_modules` however the script was invoked.
#
# ## There is no store variable here any more, and that is the change
#
# There used to be `export CHECKLIST_DATA="${CHECKLIST_DATA:-$PWD/data}"` with a
# paragraph under it explaining that Vite bundles its own config, so nothing in
# that module graph can be trusted to know where it lives, so the directory had
# to be named in the one place a bundler cannot move.
#
# The paragraph was right and the variable is gone, because the store is no
# longer beside this program at all: it is
# `<projectPath>/.kehikot/checklist/checklists.json`,
# and `projectPath` arrives in `roadmap.context` from whichever host framed the
# page. There is therefore nothing here for a launcher to configure and nothing
# for a bundler to get wrong — a checklist belongs to the project it is about,
# this script cannot know which project that will be, and a script that exported
# a default would be handing this app a place to write that nobody chose. See
# `store.ts`: a silently wrong location is worse than a loud absent one.
#
# It does NOT register. Registration is a deliberate act by a person — see
# `register.ts` — and a start script that quietly wrote into somebody's home
# directory would be doing it on their behalf.
#
# ## There is no build here, and no `dist`
#
# There was, in the program this was extracted from: the page was a string
# served by `Bun.serve`. The argument for building and serving off disk is that
# starting should be starting — a start that shells out to a build is a start
# that fails when the network is down. The argument is fine and the shape is
# still wrong, because this program is not deployed: it runs on the machine of
# the person editing it. What `dist` actually buys is a STALE page served with a
# 200, every symptom of a working app and none of the changes, and that failure
# has cost this codebase whole afternoons three separate times in three different
# programs. A missing build announces itself. A stale one does not.
#
# So Vite serves the page. The manifest, the health check, the MCP door and this
# app's own store are middleware in front of the same server — see `doors()` in
# `vite.config.ts` — because a module is one origin or it is nothing, and because
# a page that fetched its own ticks from a second port would be fetching them
# cross-origin, which is to say not at all.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "installing…" >&2
  bun install >&2
fi

exec bunx vite --host 127.0.0.1 --port "${PORT:-7860}" --strictPort
