#!/bin/sh
# Starts the preview container: migrations, demo data, then the site.
#
# In CI the Payload CLI has exited with status 0 having run and printed nothing (seen on #54 and
# #58, never locally), which left the preview without its schema or demo data. The seed always
# prints a "Demo data" line when it really ran, so the setup is repeated, up to three times,
# until it does. Both steps are safe to repeat.
set -u

for attempt in 1 2 3; do
  pnpm migrate || exit $?
  output=$(pnpm seed:demo 2>&1)
  status=$?
  printf '%s\n' "$output"
  [ "$status" -eq 0 ] || exit "$status"
  if printf '%s\n' "$output" | grep -q 'Demo data'; then
    exec pnpm start
  fi
  echo "Preview setup printed no result (attempt $attempt of 3)."
done

echo 'Preview setup did not finish; not starting the site.' >&2
exit 1
