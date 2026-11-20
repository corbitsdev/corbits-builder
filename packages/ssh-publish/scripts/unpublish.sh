# Takes the app down: stops it and disables it so it does not start again. Its data, releases and
# marker stay, so publishing again picks up where it left off.
# Arguments: the project id.
PROJECT=${1-}
need "$PROJECT" "$PROJECT_SHAPE"

STAGE=unpublish
[ -d "$ROOT" ] || finish ok
hold
case $(holder "$PROJECT") in
  other) finish other_app_present ;;
  none) finish ok ;;
esac
if [ -f "$UNIT_FILE" ]; then systemctl disable --now --quiet "$UNIT"; fi
finish ok
