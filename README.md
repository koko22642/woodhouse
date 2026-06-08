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

## Optional AI backend

Set `OPENAI_API_KEY` before starting the server:

```powershell
$env:OPENAI_API_KEY = "your_api_key"
npm start
```

You can also set `OPENAI_MODEL`; otherwise the server uses `gpt-4.1-mini`.

## Current commands

- `status report`
- `what can you do`
- `remember ...`
- `clear memory`
- `time`
- `date`
- `open google`

This is intentionally small and tool-oriented so new capabilities can be added without rewriting the console.
