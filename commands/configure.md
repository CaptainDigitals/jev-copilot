---
description: Set up the OpenRouter API key for JEV Copilot with a verified, masked terminal prompt.
argument-hint: [--status | --remove]
allowed-tools: mcp__plugin_jev-copilot_jev__jev_status, Bash(node *configure*)
---

Help the user configure their OpenRouter key. Rules that cannot be broken:

- **Never ask for, accept, or echo the key in this chat.** If the user pastes a key here, tell them to revoke it at openrouter.ai and create a new one, because chat transcripts are stored.
- The key is entered only in a terminal prompt with hidden input, verified against OpenRouter, then stored in `~/.jev-copilot/credentials.json` (user-private). Claude Code's own `/plugin → JEV Copilot → Configure` panel remains the preferred place when it is available; the terminal flow exists for environments without that panel (for example the desktop app).

Steps:

1. If `$ARGUMENTS` is `--status` or `--remove`, run the corresponding command and report the output:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/src/cli.js" configure $ARGUMENTS
```

2. Otherwise tell the user to run this in any terminal (it prompts, hides the input, verifies with one tiny JEV call and prints a green ✔ on success):

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/src/cli.js" configure
```

   Explain the precedence in one sentence: plugin config panel > `OPENROUTER_API_KEY` environment variable > credentials file.

3. When the user says it is done, call `jev_status` and report `keySource`, `api` and the model. If the API is still not connected, the running session started before the key existed: ask them to restart the Claude Code session and check again.
