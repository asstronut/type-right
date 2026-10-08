#!/bin/bash
# Cloud sessions only: install npm deps and the plugin declared in settings.json.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

npm install --no-save

if ! claude plugin list 2>/dev/null | grep -q "mattpocock-skills@mattpocock"; then
  claude plugin marketplace add mattpocock/skills
  claude plugin install mattpocock-skills@mattpocock --scope user
fi
