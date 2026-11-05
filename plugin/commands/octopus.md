---
description: Code Octopus — today's summary from your desktop octopus (unofficial fan project)
allowed-tools: Bash(curl:*)
---
The Code Octopus desktop pet keeps local stats about today's work with Claude. Its reply (JSON from the pet app on this machine, 127.0.0.1:23333):

!`curl -s -m 3 --noproxy 127.0.0.1 http://127.0.0.1:23333/summary`

Tell the user, in their language and in two to four short lines, what today looked like: busy time, tool calls, messages, tests passed / failed, commits and pushes, cost, and the octopus's level and title. Mention the last few commit messages only if there are any. Keep it light; no tables.

If the output above is empty or isn't JSON, the desktop pet isn't running: say so in one sentence and suggest starting the Code Octopus app.
