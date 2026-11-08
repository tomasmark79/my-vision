#!/usr/bin/env bash
# Run the real preferences widgets on an isolated display and memory settings.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
test_directory=$(mktemp -d)
test_x_pid=''
cleanup() {
    if [[ -n "$test_x_pid" ]]; then kill "$test_x_pid" 2>/dev/null || true; fi
    rm -rf -- "$test_directory"
}
trap cleanup EXIT
unzip -p dist/my-vision@digitalspace.name.zip resources.gresource > "$test_directory/resources.gresource"
Xvfb -displayfd 3 -screen 0 1280x900x24 3>"$test_directory/display" >"$test_directory/xvfb.log" 2>&1 &
test_x_pid=$!
for ((attempt=0; attempt<100; attempt++)); do
    [[ -s "$test_directory/display" ]] && break
    kill -0 "$test_x_pid"
    sleep 0.05
done
DISPLAY=":$(cat "$test_directory/display")" GDK_BACKEND=x11 GSK_RENDERER=cairo GSETTINGS_BACKEND=memory \
    gjs -m tests/preferences.js "$test_directory"
