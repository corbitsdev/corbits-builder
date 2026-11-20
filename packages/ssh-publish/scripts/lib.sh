# Shared by every server script. Each script is this file followed by the script's own text, run
# as root by /bin/sh with its parameters as quoted arguments. It prints only key=value lines on
# standard output, ending with code=<code>. The output of the commands it runs goes to a log or
# nowhere, so none of it reaches the tool.
set -eu
umask 022
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
cd /

ROOT=/srv/builder
BUN_HOME=/opt/builder
UNIT_FILE=/etc/systemd/system/builder-app.service
MARKER=$ROOT/project
LOCK=$ROOT/lock
UNIT=builder-app
BUN=$BUN_HOME/bun/bin/bun
APP_USER=builder
NL='
'

STAGE=script
DONE=
say() { printf '%s=%s\n' "$1" "$2"; }
finish() {
  DONE=1
  say code "$1"
  exit 0
}
# A step that fails without the script saying why ends as unexpected, naming the stage it was in.
unexpected() {
  say step "$STAGE"
  finish unexpected
}
trap 'if [ -z "$DONE" ]; then say step "$STAGE"; say code unexpected; fi' EXIT

# Locks the server for the rest of this script, or ends it as busy while another script that changes
# the server runs. A release cut off by the tool's limit may still be running. Two releases at once
# would each take the other for the previous release, and one could move the data from under the
# other. The app's commands never inherit the lock, so nothing the app leaves running can hold it.
hold() {
  exec 9>>"$LOCK"
  flock -n 9 || finish busy
}

# The tool checks every parameter before sending it, so a value of the wrong shape here came from
# somewhere else.
valid() {
  case $1 in *"$NL"*) return 1 ;; esac
  printf '%s\n' "$1" | grep -Eqx -- "$2"
}
need() {
  valid "$1" "$2" || finish invalid_parameter
}
need_command() {
  case $1 in "" | *"$NL"*) finish invalid_parameter ;; esac
}

PROJECT_SHAPE='[A-Za-z0-9-]{1,64}'
VERSION_SHAPE='[0-9]+\.[0-9]+\.[0-9]+'

# Whose app the server holds: none, this project's, or another's.
holder() {
  if [ ! -f "$MARKER" ]; then
    echo none
  elif [ "$(cat "$MARKER")" = "$1" ]; then
    echo this
  else
    echo other
  fi
}

# Whether the app gives any HTTP response on port 80 of this machine.
answers() {
  [ -x "$BUN" ] || return 1
  "$BUN" -e 'try { await fetch("http://127.0.0.1:80/", { redirect: "manual", signal: AbortSignal.timeout(3000) }); } catch { process.exit(1); }' >/dev/null 2>&1
}

# Waits up to a minute for the app to answer. The tool's limit leaves room for two such waits.
wait_answering() {
  tries=0
  until_time=$(($(date +%s) + 60))
  while [ "$tries" -lt 60 ] && [ "$(date +%s)" -lt "$until_time" ]; do
    if answers; then return 0; fi
    tries=$((tries + 1))
    sleep 1
  done
  return 1
}
