#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell.
#   - No port on this command line, and no `--strictPort`. Both used to be here,
#     and 7860 was written twice — once at the bottom of this file and once in
#     `register.ts` — so moving this app meant two edits and then remembering
#     that the file in `~/.roadmap/modules` still named the old address. It is
#     said once now, beside the id, as `PREFERRED_PORT` in `manifest.ts`, and
#     `serves()` in `vite.config.ts` acts on it.
#
#     $PORT is still honoured, by the plugin instead of by this line, and for
#     exactly the reason this bullet always gave: whoever starts this chose the
#     port, and an app that picked its own would answer somewhere nobody is
#     looking. A host that starts this passes the port from the registration,
#     which is the address it is about to go and look at.
#
#     What `--strictPort` bought was an app that DIED on a taken port —
#     `Error: Port 7860 is already in use`, exit 1 — rather than one answering
#     quietly somewhere else. That was the only honest option while nothing
#     handled a collision. `serves()` handles it: a free 7860 is taken in
#     silence, this module already answering there ends the start cleanly instead
#     of making a second copy, and anything else is a loud move with the
#     registration rewritten to the port actually bound.
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
# It does NOT register a module that had none. Registration is a deliberate act
# by a person — see `register.ts` — and a start script that quietly wrote into
# somebody's home directory would be doing it on their behalf. That stands. What
# the Vite plugin writes on every start is this module's ADDRESS, which is a
# different sentence: the person decided to be framed, they did not decide to be
# framed at 7860 in particular, and a registration still naming a port this app
# has drifted off is one the host sweeps to find nothing.
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

exec bunx vite
