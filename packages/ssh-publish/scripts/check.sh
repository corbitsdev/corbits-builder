# Reports on the server without changing anything: its OS, whether it runs systemd, free disk,
# whether port 80 is free, whose app it holds and whether it is prepared.
# Arguments: the project id, the Bun version a prepared server runs.
PROJECT=${1-}
BUN_VERSION=${2-}
need "$PROJECT" "$PROJECT_SHAPE"
need "$BUN_VERSION" "$VERSION_SHAPE"

STAGE=look
os=
os_version=
if [ -r /etc/os-release ]; then
  os=$(sed -n 's/^ID=//p' /etc/os-release | tr -d '"' | head -n 1)
  os_version=$(sed -n 's/^VERSION_ID=//p' /etc/os-release | tr -d '"' | head -n 1)
fi
say os "$os"
say os_version "$os_version"
say arch "$(uname -m)"
if [ -d /run/systemd/system ]; then say systemd yes; else say systemd no; fi

where=$ROOT
[ -d "$where" ] || where=/
say disk_free_mb "$(df -Pk "$where" | awk 'NR == 2 { print int($4 / 1024) }')"

# A listening socket on port 80 (hex 0050), IPv4 or IPv6.
listening=$(awk 'NR > 1 && $4 == "0A" { n = split($2, local, ":"); if (local[n] == "0050") print "yes" }' /proc/net/tcp /proc/net/tcp6 2>/dev/null | head -n 1)
if [ -z "$listening" ]; then
  say port80 free
elif systemctl is-active --quiet "$UNIT" 2>/dev/null; then
  say port80 ours
else
  say port80 taken
fi

say holder "$(holder "$PROJECT")"
if [ -x "$BUN_HOME/bun-$BUN_VERSION/bin/bun" ]; then say bun yes; else say bun no; fi
if [ -f "$UNIT_FILE" ]; then say unit yes; else say unit no; fi
finish ok
