# Sets up the server to run this project's app and skips what is already done: an unprivileged
# user to run the app as, the folders for releases and data, the marker naming the project, the
# Bun runtime and the systemd unit.
# Arguments: the project id, the Bun version, and the SHA-256 of the Bun binary on standard
# input, or "none" when the server has that version already.
PROJECT=${1-}
BUN_VERSION=${2-}
BUN_SHA256=${3-}
need "$PROJECT" "$PROJECT_SHAPE"
need "$BUN_VERSION" "$VERSION_SHAPE"
need "$BUN_SHA256" '[0-9a-f]{64}|none'

STAGE=prepare
mkdir -p "$ROOT"
chmod 755 "$ROOT"
hold
[ "$(holder "$PROJECT")" != other ] || finish other_app_present

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$ROOT/home" --no-create-home \
    --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$ROOT/releases" "$ROOT/data" "$ROOT/snapshots" "$ROOT/logs" "$ROOT/home"
chmod 755 "$ROOT/releases" "$ROOT/data"
chmod 700 "$ROOT/snapshots" "$ROOT/logs"
chown "$APP_USER:$APP_USER" "$ROOT/home" "$ROOT/data"
printf '%s\n' "$PROJECT" >"$MARKER"

BUN_DIR=$BUN_HOME/bun-$BUN_VERSION/bin
if [ "$BUN_SHA256" != none ]; then
  STAGE=runtime
  mkdir -p "$BUN_DIR"
  cat >"$BUN_DIR/bun.new"
  printf '%s  %s\n' "$BUN_SHA256" "$BUN_DIR/bun.new" | sha256sum -c --status - ||
    {
      rm -f "$BUN_DIR/bun.new"
      finish runtime_mismatch
    }
  chmod 755 "$BUN_DIR/bun.new"
  mv -f "$BUN_DIR/bun.new" "$BUN_DIR/bun"
fi
[ -x "$BUN_DIR/bun" ] || unexpected
ln -sfn "bun-$BUN_VERSION" "$BUN_HOME/bun.new"
mv -T "$BUN_HOME/bun.new" "$BUN_HOME/bun"

# Each release has start and env files with its start command and port variable, so pointing
# current back at an earlier release also restores how that release started.
# The default KillMode stops every process the start command spawned, not only the first.
STAGE=unit
cat >"$UNIT_FILE.new" <<UNIT
[Unit]
Description=The app Builder publishes to this server
After=network-online.target
Wants=network-online.target
ConditionPathExists=$ROOT/current/start

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$ROOT/current/app
Environment=NODE_ENV=production
Environment=HOME=$ROOT/home
Environment=PATH=$BUN_HOME/bun/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=$ROOT/current/env
ExecStart=/bin/sh $ROOT/current/start
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
mv -f "$UNIT_FILE.new" "$UNIT_FILE"
systemctl daemon-reload
systemctl enable --quiet "$UNIT"
finish ok
