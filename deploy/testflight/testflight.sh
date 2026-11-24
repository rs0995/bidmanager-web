#!/bin/bash
# testflight.sh: archive any iOS / React Native / Expo app on this Mac and upload it to TestFlight.
#
#   testflight.sh <path> [options]   start a build (detaches immediately, prints the run name)
#   testflight.sh status [<run|scheme>]   show the latest run (or a named one)
#   testflight.sh list                    recent runs
#
# <path> must be the app folder, its ios/ folder, or the folder holding the .xcworkspace/.xcodeproj.
# Any other folder is only searched (4 levels deep) to list the app folders inside it. Options:
#   --pull               git fetch + fast-forward the repo's current branch first (never discards
#                        local changes; uncommitted files are built as-is and listed in the run)
#   --prebuild           run `npx expo prebuild --platform ios` first (Expo apps, after native or
#                        app.json changes; automatic when an Expo app has no ios/ folder yet)
#   --auto-build-number  let App Store Connect assign the next build number instead of uploading
#                        the project's own (the project's number is the default)
#   --scheme S --workspace W --api-key K --team T   override auto-detection / defaults
#
# Settings: ~/.testflight/defaults.env (TEAM_ID, ISSUER_ID, API_KEY_ID). The login-keychain
# password is read from ~/.testflight/keychain-pass (mode 600); codesign over SSH needs the
# keychain unlocked in the same process tree as xcodebuild, which is why this script unlocks it.

set -u
TF_HOME="$HOME/.testflight"
RUNS="$TF_HOME/runs"
ARCHIVES="$TF_HOME/archives"
KEEP_RUNS=20
[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
TEAM_ID="" ISSUER_ID="" API_KEY_ID=""
[ -f "$TF_HOME/defaults.env" ] && . "$TF_HOME/defaults.env"

die() { echo "ERROR: $*" >&2; exit 1; }

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------- project detection
# Sets IOS_DIR, APP_DIR, NEED_PREBUILD. IOS_DIR may not exist yet when NEED_PREBUILD=1.
find_project_dir() {
  local p="$1" hits n
  case "$p" in "~"*) p="$HOME${p#\~}" ;; esac
  [ -d "$p" ] || die "Folder not found: $1"
  p=$(cd "$p" && pwd)
  NEED_PREBUILD=0
  if ls -d "$p"/*.xcworkspace "$p"/*.xcodeproj >/dev/null 2>&1; then
    IOS_DIR="$p"; APP_DIR="$p"; [ "$(basename "$p")" = ios ] && APP_DIR=$(dirname "$p"); return
  fi
  if [ -d "$p/ios" ]; then IOS_DIR="$p/ios"; APP_DIR="$p"; return; fi
  if [ -f "$p/app.json" ] || [ -f "$p/app.config.js" ] || [ -f "$p/app.config.ts" ]; then
    IOS_DIR="$p/ios"; APP_DIR="$p"; NEED_PREBUILD=1; return
  fi
  hits=$(find "$p" -maxdepth 4 \( -name node_modules -o -name Pods -o -name .git -o -name build \) -prune -o \
    -type d \( -name '*.xcworkspace' -o -name '*.xcodeproj' \) -print 2>/dev/null \
    | grep -v '\.xcodeproj/' | xargs -I{} dirname {} | sort -u)
  n=$(printf '%s\n' "$hits" | grep -c .)
  # Never build something found by searching: a vague folder must not start an upload of whatever
  # project happens to be inside it. List what's there and ask for the exact folder instead.
  [ "$n" -eq 0 ] && die "No Xcode project (.xcworkspace/.xcodeproj), ios/ folder or Expo app.json found in $p."
  die "$p isn't an app folder itself. Xcode projects found inside it; pass one of these folders:
$hits"
}

# Sets CONTAINER_FLAG/CONTAINER and SCHEME (honouring --workspace/--scheme overrides).
find_workspace_and_scheme() {
  local list n schemes
  if [ -n "$OPT_WORKSPACE" ]; then
    CONTAINER="$OPT_WORKSPACE"; case "$CONTAINER" in /*) ;; *) CONTAINER="$IOS_DIR/$CONTAINER" ;; esac
  else
    list=$(ls -d "$IOS_DIR"/*.xcworkspace 2>/dev/null)
    n=$(printf '%s\n' "$list" | grep -c .)
    if [ "$n" -eq 0 ]; then
      list=$(ls -d "$IOS_DIR"/*.xcodeproj 2>/dev/null); n=$(printf '%s\n' "$list" | grep -c .)
      [ "$n" -eq 0 ] && die "No .xcworkspace or .xcodeproj in $IOS_DIR."
    fi
    [ "$n" -eq 1 ] || die "Several candidates in $IOS_DIR; pass --workspace with one of:
$(printf '%s\n' "$list" | xargs -n1 basename)"
    CONTAINER="$list"
  fi
  [ -e "$CONTAINER" ] || die "Not found: $CONTAINER"
  case "$CONTAINER" in *.xcworkspace) CONTAINER_FLAG=-workspace ;; *) CONTAINER_FLAG=-project ;; esac
  schemes=$(xcodebuild -list "$CONTAINER_FLAG" "$CONTAINER" 2>/dev/null \
    | awk '/^ *Schemes:/{f=1;next} f&&NF{sub(/^ +/,"");print} f&&!NF{exit}')
  SCHEME="${OPT_SCHEME:-$(basename "$CONTAINER" | sed 's/\.[^.]*$//')}"
  printf '%s\n' "$schemes" | grep -qxF "$SCHEME" || die "Scheme '$SCHEME' not found in $(basename "$CONTAINER"); pass --scheme with one of:
$(printf '%s\n' "$schemes" | grep -v '^Pods-' | head -30)"
}

# ---------------------------------------------------------------- status / list
latest_run() {  # optional prefix filter
  ls -1t "$RUNS" 2>/dev/null | grep "^${1:-}" | head -1
}

cmd_status() {
  local run="${1:-}" step pid
  if [ -n "$run" ] && [ ! -d "$RUNS/$run" ]; then run=$(latest_run "$run-"); fi
  [ -z "$run" ] && run=$(latest_run)
  [ -n "$run" ] && [ -d "$RUNS/$run" ] || { echo "No runs yet."; return 0; }
  echo "run: $run"
  cat "$RUNS/$run/status" 2>/dev/null
  pid=$(cat "$RUNS/$run/pid" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    step=$(cat "$RUNS/$run/step" 2>/dev/null)
    echo "(still running: $step; started $(cat "$RUNS/$run/started" 2>/dev/null))"
    [ -f "$RUNS/$run/$step.log" ] && tail -2 "$RUNS/$run/$step.log" | cut -c1-200
  fi
}

cmd_list() {
  local r
  [ -n "$(ls -A "$RUNS" 2>/dev/null)" ] || { echo "No runs yet."; return 0; }
  ls -1t "$RUNS" | head -15 | while read -r r; do
    printf '%-38s %s\n' "$r" "$(head -1 "$RUNS/$r/status" 2>/dev/null)"
  done
}

# ---------------------------------------------------------------- the detached build
set_status() { echo "$*" > "$RUN_DIR/status"; echo "$(date '+%H:%M:%S') $*" >> "$RUN_DIR/events.log"; }
set_step() { echo "$1" > "$RUN_DIR/step"; set_status "RUNNING $1"; }
fail() {  # step, log file
  local errs
  errs=$( { grep -E 'error:|ERROR|❌' "$RUN_DIR/$2" 2>/dev/null | grep -v -i warning | head -5; } || true)
  [ -n "$errs" ] || errs=$(tail -5 "$RUN_DIR/$2" 2>/dev/null)
  set_status "FAILED $1: $(printf '%s' "$errs" | tr '\n' ' ' | cut -c1-600)"
  echo "see $RUN_DIR/$2" >> "$RUN_DIR/status"
  exit 1
}
unlock_keychain() {
  [ -f "$TF_HOME/keychain-pass" ] || { set_status "FAILED keychain: $TF_HOME/keychain-pass is missing"; exit 1; }
  security unlock-keychain -p "$(cat "$TF_HOME/keychain-pass")" "$HOME/Library/Keychains/login.keychain-db" \
    > /dev/null 2>&1 || { set_status "FAILED keychain: could not unlock the login keychain (wrong password in keychain-pass?)"; exit 1; }
}

run_build() {
  RUN_DIR="$1"
  . "$RUN_DIR/run.env"
  date '+%Y-%m-%d %H:%M:%S' > "$RUN_DIR/started"
  local repo branch app info bundle version build plist dd

  if [ "$PULL" = 1 ]; then
    set_step pull
    repo=$(git -C "$APP_DIR" rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo" > "$RUN_DIR/pull.log"; fail pull pull.log; }
    branch=$(git -C "$repo" rev-parse --abbrev-ref HEAD)
    { git -C "$repo" fetch origin "$branch" && git -C "$repo" merge --ff-only "origin/$branch"; } > "$RUN_DIR/pull.log" 2>&1 || fail pull pull.log
  fi
  repo=$(git -C "$APP_DIR" rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$repo" ]; then
    { echo "commit: $(git -C "$repo" log --oneline -1)"
      echo "uncommitted files built as-is: $(git -C "$repo" status --short | wc -l | tr -d ' ')"
      git -C "$repo" status --short | head -20; } > "$RUN_DIR/source.txt"
  fi

  if [ "$PREBUILD" = 1 ]; then
    set_step prebuild
    (cd "$APP_DIR" && CI=1 npx expo prebuild --platform ios) > "$RUN_DIR/prebuild.log" 2>&1 || fail prebuild prebuild.log
    ( find_workspace_and_scheme && printf 'CONTAINER=%q\nCONTAINER_FLAG=%q\nSCHEME=%q\n' "$CONTAINER" "$CONTAINER_FLAG" "$SCHEME" > "$RUN_DIR/resolved.env" ) \
      > "$RUN_DIR/resolve.log" 2>&1 || fail prebuild resolve.log
    . "$RUN_DIR/resolved.env"
  fi

  set_step archive
  mkdir -p "$ARCHIVES"
  ARCHIVE="$ARCHIVES/$SCHEME.xcarchive"
  rm -rf "$ARCHIVE"
  for dd in "$HOME"/Library/Developer/Xcode/DerivedData/"$SCHEME"-*; do [ -d "$dd" ] && rm -rf "$dd"; done
  unlock_keychain
  (cd "$IOS_DIR" && xcodebuild archive "$CONTAINER_FLAG" "$CONTAINER" -scheme "$SCHEME" -configuration Release \
      -destination "generic/platform=iOS" -archivePath "$ARCHIVE" -allowProvisioningUpdates \
      -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$API_KEY_ID.p8" \
      -authenticationKeyID "$API_KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID" \
      DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic) > "$RUN_DIR/archive.log" 2>&1
  grep -q '\*\* ARCHIVE SUCCEEDED \*\*' "$RUN_DIR/archive.log" || fail archive archive.log

  app=$(ls -d "$ARCHIVE"/Products/Applications/*.app 2>/dev/null | head -1)
  info="$app/Info.plist"
  bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info" 2>/dev/null)
  version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info" 2>/dev/null)
  build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info" 2>/dev/null)
  echo "$bundle $version ($build)" > "$RUN_DIR/app.txt"

  set_step export
  plist="$TF_HOME/ExportOptions-upload.plist"
  [ "$AUTO_BUILD" = 1 ] && plist="$TF_HOME/ExportOptions-autonumber.plist"
  unlock_keychain
  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$RUN_DIR/export" -exportOptionsPlist "$plist" \
    -allowProvisioningUpdates -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$API_KEY_ID.p8" \
    -authenticationKeyID "$API_KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID" > "$RUN_DIR/export.log" 2>&1
  if grep -q '\*\* EXPORT SUCCEEDED \*\*' "$RUN_DIR/export.log"; then
    if [ "$AUTO_BUILD" = 1 ]; then set_status "UPLOADED $bundle $version (build number assigned by App Store Connect)"
    else set_status "UPLOADED $bundle $version ($build)"; fi
  elif grep -qiE 'bundle version must be higher|already been used|has already been uploaded' "$RUN_DIR/export.log"; then
    set_status "DUPLICATE_BUILD $bundle $version ($build): that build number is already in TestFlight; bump the build number and run again (or use --auto-build-number)"
  else
    fail export export.log
  fi
  rm -rf "$RUN_DIR/export"
}

# ---------------------------------------------------------------- start a run
cmd_start() {
  local path="$1"; shift
  PULL=0 PREBUILD=0 AUTO_BUILD=0 OPT_SCHEME="" OPT_WORKSPACE=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --pull) PULL=1 ;;
      --prebuild) PREBUILD=1 ;;
      --auto-build-number) AUTO_BUILD=1 ;;
      --scheme) OPT_SCHEME="${2:?--scheme needs a value}"; shift ;;
      --workspace) OPT_WORKSPACE="${2:?--workspace needs a value}"; shift ;;
      --api-key) API_KEY_ID="${2:?--api-key needs a value}"; shift ;;
      --team) TEAM_ID="${2:?--team needs a value}"; shift ;;
      *) die "Unknown option: $1 (see: testflight.sh help)" ;;
    esac
    shift
  done
  [ -n "$TEAM_ID" ] && [ -n "$ISSUER_ID" ] && [ -n "$API_KEY_ID" ] || die "TEAM_ID/ISSUER_ID/API_KEY_ID missing (set them in $TF_HOME/defaults.env)."
  [ -f "$HOME/.appstoreconnect/private_keys/AuthKey_$API_KEY_ID.p8" ] || die "API key file AuthKey_$API_KEY_ID.p8 not found in ~/.appstoreconnect/private_keys."
  [ -f "$TF_HOME/keychain-pass" ] || die "$TF_HOME/keychain-pass is missing."
  if pgrep -x xcodebuild > /dev/null; then die "Another xcodebuild is running; wait for it to finish (testflight.sh status)."; fi

  find_project_dir "$path"
  [ "$NEED_PREBUILD" = 1 ] && PREBUILD=1
  CONTAINER="" CONTAINER_FLAG="" SCHEME=""
  if [ "$PREBUILD" = 1 ] && [ ! -d "$IOS_DIR" ]; then
    SCHEME="${OPT_SCHEME:-$(basename "$APP_DIR" | tr -cd 'A-Za-z0-9_-')}"
  else
    find_workspace_and_scheme
  fi

  mkdir -p "$RUNS"
  RUN_NAME="$SCHEME-$(date +%Y%m%d-%H%M%S)"
  RUN_DIR="$RUNS/$RUN_NAME"
  mkdir -p "$RUN_DIR"
  printf 'APP_DIR=%q\nIOS_DIR=%q\nCONTAINER=%q\nCONTAINER_FLAG=%q\nSCHEME=%q\nPULL=%q\nPREBUILD=%q\nAUTO_BUILD=%q\nOPT_SCHEME=%q\nOPT_WORKSPACE=%q\nAPI_KEY_ID=%q\nTEAM_ID=%q\nISSUER_ID=%q\n' \
    "$APP_DIR" "$IOS_DIR" "$CONTAINER" "$CONTAINER_FLAG" "$SCHEME" "$PULL" "$PREBUILD" "$AUTO_BUILD" "$OPT_SCHEME" "$OPT_WORKSPACE" "$API_KEY_ID" "$TEAM_ID" "$ISSUER_ID" > "$RUN_DIR/run.env"
  echo "QUEUED" > "$RUN_DIR/status"
  nohup "$0" __run "$RUN_DIR" > "$RUN_DIR/runner.log" 2>&1 < /dev/null &
  echo $! > "$RUN_DIR/pid"
  disown 2>/dev/null || true

  ls -1t "$RUNS" | tail -n +$((KEEP_RUNS + 1)) | while read -r old; do rm -rf "${RUNS:?}/$old"; done

  echo "Started run: $RUN_NAME"
  echo "  project: ${CONTAINER:-$IOS_DIR (after prebuild)}"
  echo "  scheme:  $SCHEME   pull=$PULL prebuild=$PREBUILD auto-build-number=$AUTO_BUILD"
  echo "Check progress with: testflight.sh status $RUN_NAME"
}

case "${1:-}" in
  ""|help|-h|--help) usage ;;
  status) cmd_status "${2:-}" ;;
  list) cmd_list ;;
  __run) run_build "$2" ;;
  *) cmd_start "$@" ;;
esac
