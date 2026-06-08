# Woodhouse JARVIS

A local JARVIS-style assistant prototype with typed commands, browser voice input, speech output, local memory, and an optional OpenAI backend.

## Run

```powershell
npm start
```

Open `http://localhost:4173`.

## Run on GitHub Pages

This project includes a GitHub Pages workflow at `.github/workflows/pages.yml`.
After pushing the repo to GitHub, enable Pages with **GitHub Actions** as the source.

The hosted GitHub Pages version runs the browser-only assistant UI. The optional
OpenAI backend in `server.js` is for local/server hosting and does not run on
GitHub Pages.

## Run smart mode on a phone

Deploy the Node app as a web service so the API key stays on the server.
This repo includes a Render blueprint at `render.yaml`.

On Render:

1. Create a new Blueprint from this GitHub repo.
2. Set the `OPENAI_API_KEY` environment variable when Render asks for it.
3. Set `WOODHOUSE_SYNC_KEY` to a private phrase you will enter on each device.
4. Deploy the service.

Render will provide a public URL like `https://woodhouse.onrender.com`.
Open that URL on your phone for smart mode.

Enter the same sync key in the Woodhouse Sync panel on every device to share
memory, notes, and reminders through the backend.

## Optional AI backend

For smart mode, run Woodhouse locally with an OpenAI API key. Keep this key off
GitHub Pages; Pages is static and cannot safely hide secrets.

Set `OPENAI_API_KEY` before starting the server:

```powershell
$env:OPENAI_API_KEY = "your_api_key"
npm start
```

You can also set `OPENAI_MODEL`; otherwise the server uses `gpt-5.4-mini`.

```powershell
$env:OPENAI_MODEL = "gpt-5.4-mini"
```

When smart mode is active, the Systems panel shows the model name instead of
`Local`.

## Current commands

- `status report`
- `what can you do`
- `remember ...`
- `note ...`
- `list notes`
- `clear notes`
- `remind me to ...`
- `remind me tomorrow at 8 AM to ...`
- `remind me every Friday to ...`
- `list reminders`
- `due today`
- `overdue reminders`
- `complete reminder 1`
- `test notification`
- `clear reminders`
- `daily brief`
- `clear memory`
- `time`
- `date`
- `open google`

This is intentionally small and tool-oriented so new capabilities can be added without rewriting the console.
