#!/usr/bin/env bash
#
# Keeps a Docker Compose deployment up to date: pulls new commits of the checked out branch, rebuilds, downloads the
# web client again when the pulled code pins a different Discord build (client/release.json) and restarts. Meant for
# a systemd timer or cron every 30 seconds to a few minutes, so a merge to main reaches the instance shortly after, see
# "Automatic updates" in docs/self-hosting/setup.md. A run with nothing new only does a git fetch.
#
# Settings, all optional, as environment variables:
#   ENV_FILE        compose env file, when it isn't .env (for example prod.env)
#   UPDATE_CODE     0 to leave the code alone and only check the web client
#   UPDATE_CLIENT   0 to leave the web client alone and only update the code
#   SERVER_PORT     the server's port on the host, 32171 unless you changed it in the env file
#   NOTIFY_WEBHOOK  a Discord or Fosscord webhook URL that gets a message when something was updated or went wrong
#   LOCK_FILE       where the lock that stops two runs overlapping lives, /tmp/fosscord-auto-update.lock by default
#   FAILED_FILE     remembers a commit whose update failed, so it isn't retried every run, $LOCK_FILE.failed by default

set -euo pipefail

cd "$(dirname "$0")/.."

log() { echo "[$(date '+%F %T')] $*"; }

notify() {
    log "$1"
    [ -n "${NOTIFY_WEBHOOK:-}" ] || return 0
    local text=${1//\\/\\\\}
    text=${text//\"/\\\"}
    curl -fsS -m 15 -H "content-type: application/json" -d "{\"content\":\"$text\"}" "$NOTIFY_WEBHOOK" >/dev/null || log "could not reach the notify webhook"
}

compose() {
    if [ -n "${ENV_FILE:-}" ]; then docker compose --env-file "$ENV_FILE" "$@"; else docker compose "$@"; fi
}

# one run at a time: a client download can take a few minutes
LOCK_FILE=${LOCK_FILE:-/tmp/fosscord-auto-update.lock}
if command -v flock >/dev/null; then
    exec 9>"$LOCK_FILE"
    flock -n 9 || { log "another update is still running, skipping"; exit 0; }
elif ! mkdir "$LOCK_FILE.d" 2>/dev/null; then
    log "another update is still running, skipping"
    exit 0
else
    trap 'rmdir "$LOCK_FILE.d"' EXIT
fi

FAILED_FILE=${FAILED_FILE:-$LOCK_FILE.failed}
code_updated=0
client_updated=0
failed=0

# 1. code: fast-forward to the branch's upstream and rebuild the images
if [ "${UPDATE_CODE:-1}" != 0 ]; then
    git fetch --quiet
    local_head=$(git rev-parse HEAD)
    upstream=$(git rev-parse '@{u}')
    if [ "$local_head" != "$upstream" ]; then
        if [ "$(cat "$FAILED_FILE" 2>/dev/null)" = "$upstream" ]; then
            # already reported; a new commit upstream, or deleting $FAILED_FILE, tries again
            log "$(git rev-parse --short "$upstream") failed to update before, waiting for a newer commit"
            exit 1
        fi
        if git merge --ff-only --quiet "$upstream"; then
            log "pulled $(git rev-parse --short "$local_head")..$(git rev-parse --short HEAD), rebuilding the images"
            if REVISION=$(git rev-parse HEAD) REVISION_TIME=$(git log -1 --format=%ct) compose build; then
                code_updated=1
            else
                notify "Auto-update: building $(git rev-parse --short HEAD) failed, the running version stays up."
                failed=1
                echo "$upstream" >"$FAILED_FILE"
                # back to the commit that is running; --keep leaves local edits alone
                git reset --quiet --keep "$local_head"
            fi
        else
            notify "Auto-update: the checkout can't fast-forward to $(git rev-parse --short "$upstream") (local commits or changes?), skipped the code update."
            failed=1
            echo "$upstream" >"$FAILED_FILE"
        fi
    fi
fi

# 2. web client: the server refuses to start on a client build other than the one client/release.json pins, so when
# the pulled code moved the pin, download the pinned build with the new image before anything restarts. Only checked
# after a code update (or with UPDATE_CODE=0), so runs with nothing new don't start a container.
if [ "${UPDATE_CLIENT:-1}" != 0 ] && { [ "$code_updated" = 1 ] || [ "${UPDATE_CODE:-1}" = 0 ]; }; then
    build_of() { grep -o '"BUILD_NUMBER":"[0-9]*"' | head -n1 | grep -o '[0-9][0-9]*' || true; }
    pinned=$(grep -o '"buildNumber": *"[0-9]*"' client/release.json | grep -o '[0-9][0-9]*' || true)
    current=$(compose run --rm --no-deps -T --entrypoint sh client -c 'cat assets/cache/index.html 2>/dev/null || true' | build_of) || current=""
    if [ -n "$pinned" ] && [ "$pinned" != "$current" ]; then
        log "client/release.json pins build $pinned, the instance has ${current:-none}, downloading it"
        # client.js only adds files and publishes the new index.html last, when every asset arrived, so the running
        # server keeps serving the old build until it restarts, and a failed download changes nothing
        if compose run --rm --no-deps -T client client --force; then
            client_updated=1
        else
            failed=1
            if [ "$code_updated" = 1 ]; then
                # the new code would refuse the old client, so stay on the running commit and rebuild its images
                notify "Auto-update: downloading client build $pinned for $(git rev-parse --short HEAD) failed, staying on $(git rev-parse --short "$local_head")."
                echo "$upstream" >"$FAILED_FILE"
                git reset --quiet --keep "$local_head"
                REVISION=$(git rev-parse HEAD) REVISION_TIME=$(git log -1 --format=%ct) compose build || true
                code_updated=0
            else
                notify "Auto-update: downloading client build $pinned failed, build ${current:-none} stays."
            fi
        fi
    fi
fi

[ "$code_updated" = 1 ] && rm -f "$FAILED_FILE"

# 3. restart what changed and check that it came back
if [ "$code_updated" = 1 ]; then
    compose up -d
    docker image prune -f >/dev/null || true
elif [ "$client_updated" = 1 ]; then
    compose restart server
elif [ "$failed" = 1 ]; then
    log "nothing was updated"
    exit 1
else
    log "everything is up to date"
    exit 0
fi

port=${SERVER_PORT:-32171}
summary=""
[ "$code_updated" = 1 ] && summary="code $(git rev-parse --short HEAD)"
[ "$client_updated" = 1 ] && summary="${summary:+$summary and }web client build $pinned"
# a rebuilt server runs its migrations and the client service first, so give it a few minutes
for _ in $(seq 1 60); do
    if curl -fsS -m 5 "http://127.0.0.1:$port/api/ping" >/dev/null 2>&1; then
        notify "Auto-update: now running $summary."
        exit 0
    fi
    sleep 5
done
notify "Auto-update: updated to $summary, but the server didn't answer /api/ping within 5 minutes, check docker compose logs server."
exit 1
