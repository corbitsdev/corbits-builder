# Reports whether the app is published here and answers, without changing anything.
# Arguments: the project id.
PROJECT=${1-}
need "$PROJECT" "$PROJECT_SHAPE"

STAGE=status
holds=$(holder "$PROJECT")
say holder "$holds"
[ "$holds" = this ] || finish ok
if [ -L "$ROOT/current" ]; then
  say release "$(basename "$(readlink "$ROOT/current")")"
fi
if systemctl is-active --quiet "$UNIT" 2>/dev/null; then say running yes; else say running no; fi
if answers; then say answering yes; else say answering no; fi
finish ok
