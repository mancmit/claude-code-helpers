# Claude Code Helpers

A collection of hooks, scripts, and utilities to enhance your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) workflow.

## What's inside

### Hooks

| Hook | Description |
|------|-------------|
| [log-bash](hooks/log-bash/) | Automatically log all Bash commands executed by Claude Code to daily Markdown files. Useful for auditing, reviewing, and debugging. |
| [notify-secret-read](hooks/notify-secret-read/) | Notify when Claude Code reads secret/credential files (`.env`, `*.pem`, AWS credentials, etc.) via macOS notification and terminal bell. |

## Getting started

Each hook/utility has its own README with detailed setup instructions. Browse the table above and click through to the one you need.

### General prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (CLI) installed
- macOS / Linux

## Project structure

```
claude-code-helpers/
├── hooks/
│   ├── log-bash/                # Log all Bash commands to markdown
│   │   ├── log-bash.sh
│   │   ├── settings-snippet.json
│   │   └── README.md
│   └── notify-secret-read/      # Notify on secret/credential file reads
│       ├── notify-secret-read.sh
│       ├── settings-snippet.json
│       └── README.md
└── README.md
```

## Contributing

Want to add a new hook or utility? Follow this structure:

1. Create a folder under the appropriate category (e.g. `hooks/<your-hook>/`)
2. Include the script/config files
3. Add a `README.md` with setup instructions
4. Update this main README table

## License

MIT
