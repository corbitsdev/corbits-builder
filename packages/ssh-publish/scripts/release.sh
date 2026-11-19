# Publishes one release of the app from the tar archive on standard input. It unpacks the archive,
# links its data folders to the data kept between releases, and installs and builds it as the app's
# user. Then it stops the app, copies the data, points current at the new release and starts it. If
# the app does not answer, it points current back at the previous release, restores the data and
# starts that release.
# Arguments: the project id, the release id, the seconds the install and the build may take
# together, the install, build and start commands, the port variable, then each data folder.
PROJECT=${1-}
RELEASE=${2-}
BUILD_SECONDS=${3-}
INSTALL=${4-}
BUILD=${5-}
START=${6-}
PORT_VARIABLE=${7-}
need "$PROJECT" "$PROJECT_SHAPE"
need "$RELEASE" '[0-9]{17}-[A-Za-z0-9]{1,40}'
need "$BUILD_SECONDS" '[1-9][0-9]{0,4}'
need_command "$INSTALL"
need_command "$BUILD"
need_command "$START"
need "$PORT_VARIABLE" '[A-Z][A-Z0-9_]*'
shift 7
for data in "$@"; do
  need "$data" '[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*'
  case /$data/ in */./* | */../*) finish invalid_parameter ;; esac
done
built_by=$(($(date +%s) + BUILD_SECONDS))

STAGE=release
[ -d "$ROOT" ] || unexpected
hold
case $(holder "$PROJECT") in
  other) finish other_app_present ;;
  none) unexpected ;;
esac
{ [ -f "$UNIT_FILE" ] && [ -x "$BUN" ] && [ -d "$ROOT/data" ]; } || unexpected

RELEASE_DIR=$ROOT/releases/$RELEASE
APP=$RELEASE_DIR/app
LOG=$ROOT/logs/$RELEASE.log
# Never reuse a release id: an existing release may be the one running.
if [ -e "$RELEASE_DIR" ] || [ -L "$RELEASE_DIR" ]; then unexpected; fi
: >"$LOG"

# Each step before the app stops prints that it is starting. If the tool call was cancelled or cut
# off, the connection is closed, so that write fails and the release ends at that step. From
# stopping the app until the new release or the previous one answers, the script writes nothing,
# so a closed connection cannot end it in between.
step() {
  STAGE=$1
  say stage "$1"
}

# A release that never went live leaves only its log behind.
discard() {
  rm -rf "$RELEASE_DIR"
  finish "$1"
}

# Runs a script as the app's user, with only the environment it needs and without the lock. The
# archive is the app's source, and anyone may have written it, so everything that touches its files
# runs here. At worst it does what the app itself could do when it runs.
as_app() {
  runuser -u "$APP_USER" -- env -i HOME="$ROOT/home" \
    PATH="$BUN_HOME/bun/bin:/usr/local/bin:/usr/bin:/bin" \
    /bin/sh -c "$@" >>"$LOG" 2>&1 9>&-
}

# Runs the install or the build in the app's folder. When the seconds the tool allowed for both run
# out, timeout stops the step and everything it started, so it ends inside the tool's limit. A step
# that fails or times out reports which, and the release ends there with nothing switched.
app_step() {
  step "$1"
  left=$((built_by - $(date +%s)))
  if [ "$left" -gt 0 ] &&
    as_app 'cd "$1" && exec timeout -k 10 "$3" /bin/sh -c "$2"' sh "$APP" "$2" "$left"; then
    return 0
  fi
  say step "$1"
  if [ "$(date +%s)" -ge "$built_by" ]; then discard build_timed_out; fi
  discard app_not_built
}

# Root makes the release folder and the two files the unit reads. They decide what runs with the
# port capability. The app's user owns only the app folder inside, so it cannot change those files
# or which folder is the app.
step unpack
mkdir -m 755 "$RELEASE_DIR"
printf '%s\n' "$START" >"$RELEASE_DIR/start"
printf '%s=80\n' "$PORT_VARIABLE" >"$RELEASE_DIR/env"
chmod 644 "$RELEASE_DIR/start" "$RELEASE_DIR/env"
mkdir -m 755 "$APP"
chown "$APP_USER:$APP_USER" "$APP"
as_app 'cd "$1" && exec tar -x -f - --no-same-owner --no-same-permissions' \
  sh "$APP" || {
  say step unpack
  discard unexpected
}

# What people entered lives under data, outside every release: each data folder of the app is a link
# into data. If the archive has a data folder that data lacks, the archive's copy seeds it. data
# belongs to the app's user, so this runs as that user too.
step data
as_app '
  set -eu
  app=$1 kept_root=$2
  shift 2
  for data in "$@"; do
    kept=$kept_root/$data
    if [ ! -e "$kept" ] && [ ! -L "$kept" ]; then
      mkdir -p "$kept"
      if [ -d "$app/$data" ] && [ ! -L "$app/$data" ]; then cp -a "$app/$data/." "$kept/"; fi
    fi
    rm -rf "$app/$data"
    mkdir -p "$(dirname "$app/$data")"
    ln -s "$kept" "$app/$data"
  done
' sh "$APP" "$ROOT/data" "$@" || {
  say step data
  discard unexpected
}

app_step install "$INSTALL"
app_step build "$BUILD"

# Copying the data needs room for the copy plus a 64 MB margin for the app's first writes. Without
# it the release ends here, before the app is stopped or anything is switched.
step snapshot
data_kb=$(du -sk "$ROOT/data" | awk '{ print $1 }')
free_kb=$(df -Pk "$ROOT" | awk 'NR == 2 { print $4 }')
if [ "$free_kb" -lt $((data_kb + 65536)) ]; then
  say disk_free_mb $((free_kb / 1024))
  discard disk_full
fi

# The app stops before its data is copied, so a database and its journal are copied at one moment
# and not while the app writes them. Visitors wait for the copy and the new release's start on every
# publish; a copy that can be restored is worth that pause.
running=no
if systemctl is-active --quiet "$UNIT"; then running=yes; fi
systemctl stop "$UNIT" || true
SNAPSHOT=$ROOT/snapshots/$RELEASE
rm -rf "$SNAPSHOT.new"
if ! cp -a "$ROOT/data" "$SNAPSHOT.new"; then
  rm -rf "$SNAPSHOT.new"
  if [ "$running" = yes ]; then systemctl start "$UNIT" || true; fi
  say step snapshot
  discard unexpected
fi
mv -T "$SNAPSHOT.new" "$SNAPSHOT"

previous=$(readlink "$ROOT/current" 2>/dev/null || true)
point() {
  ln -sfn "$1" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
}

STAGE=switch
point "releases/$RELEASE"
# Enabling the unit means an app that was taken down starts with the server again. The answering
# check tells whether it came up, so a failed start is rolled back like any other failure.
systemctl enable --quiet "$UNIT"
systemctl restart "$UNIT" || true
if ! wait_answering; then
  STAGE=rollback
  systemctl stop "$UNIT" || true
  # The copy made for a release that never went live has no other use, so renames on one filesystem
  # make it the data again. Nothing is copied, so a full disk cannot leave the data half restored.
  # The failed release's data is set aside until the copy is in place, and put back if the copy
  # cannot be moved, so the app always has data.
  SET_ASIDE=$ROOT/data.failed.$RELEASE
  restored=no
  if mv -T "$ROOT/data" "$SET_ASIDE"; then
    if mv -T "$SNAPSHOT" "$ROOT/data"; then
      restored=yes
      rm -rf "$SET_ASIDE"
    else
      mv -T "$SET_ASIDE" "$ROOT/data" || true
    fi
  fi
  if [ -n "$previous" ]; then
    point "$previous"
    systemctl start "$UNIT" || true
    if wait_answering; then rolled_back=yes; else rolled_back=no; fi
  else
    rm -f "$ROOT/current"
    rolled_back=none
  fi
  say rolled_back "$rolled_back"
  # The copy of the data stays in snapshots, so whoever looks at the server finds it.
  [ "$restored" = yes ] || discard rollback_failed
  discard did_not_start
fi

# Keep the newest three releases and data copies, so an earlier one can be brought back, and the
# newest ten logs. Names begin with the time, so the shell's sort order is the order of release.
STAGE=prune
current=$(basename "$(readlink "$ROOT/current")")
prune() {
  folder=$1 keep=$2
  set -- "$folder"/*
  extra=$(($# - keep))
  for old in "$@"; do
    [ "$extra" -gt 0 ] || break
    extra=$((extra - 1))
    case ${old##*/} in "$current" | "$current".*) continue ;; esac
    if [ -e "$old" ] || [ -L "$old" ]; then rm -rf "$old"; fi
  done
}
# A release with no copy of the data never went live: it was cut off before the switch.
for old in "$ROOT/releases"/*; do
  name=${old##*/}
  if [ "$name" != "$current" ] && [ ! -e "$ROOT/snapshots/$name" ]; then rm -rf "$old"; fi
done
prune "$ROOT/releases" 3
prune "$ROOT/snapshots" 3
prune "$ROOT/logs" 10
finish ok
