#!/usr/bin/env bash
set -euo pipefail

readonly artifact="${1:?Pass the checked npm archive}"
NPM_CONFIG_USERCONFIG="$(mktemp "${RUNNER_TEMP:?}/sarj-publish.XXXXXX")"
export NPM_CONFIG_USERCONFIG
export NPM_CONFIG_LOGS_MAX=0
bootstrap=0

cleanup() {
  local status=$?
  trap - EXIT
  if (( bootstrap )); then
    if ! npm logout --registry=https://registry.npmjs.org/; then
      echo 'Bootstrap token revocation failed; owner revocation is required.' >&2
      status=1
    fi
  fi
  rm -f "$NPM_CONFIG_USERCONFIG"
  exit "$status"
}
trap cleanup EXIT

node <<'JS'
const fs = require('node:fs');
const token = process.env.NPM_TOKEN;
if (token && !/^npm_[A-Za-z0-9]{20,4096}$/.test(token)) {
  throw new Error('The bootstrap credential has an invalid format.');
}
fs.writeFileSync(process.env.NPM_CONFIG_USERCONFIG,
  'registry=https://registry.npmjs.org/\n' +
  (token ? '//registry.npmjs.org/:_authToken=' + token + '\n' : ''),
  { mode: 0o600 });
JS

if [[ -n "${NPM_TOKEN:-}" ]]; then
  bootstrap=1
  unset NPM_TOKEN
  if [[ "$(npm whoami --registry=https://registry.npmjs.org/)" != 'sarj' ]]; then
    echo 'Unexpected npm publishing identity.' >&2
    exit 1
  fi
fi

# The native n8n release admission ran on these exact bytes in the unprivileged
# build job. Publishing an archive executes no project lifecycle scripts here.
npm publish "$artifact" --provenance --access public --registry=https://registry.npmjs.org/
