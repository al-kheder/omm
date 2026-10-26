---
name: omm-push
description: Push architecture docs to a configured cloud server (optional). Handles login, link, and push workflow with error guidance. Use when the user says "omm push", "push to cloud", "deploy architecture", or "share architecture".
---

# omm-push — Cloud Push Workflow

## Purpose

Automate the full workflow of pushing .omm/ architecture docs to a cloud server.

Cloud sync is optional and off by default. It only works when the `OMM_API_URL` environment variable points to a compatible server. If a command fails with "cloud sync is not configured", tell the user that everything works locally without the cloud, and that they can set `OMM_API_URL` if they run a compatible server. Then stop.

## Prerequisites

Ensure the `omm` CLI is available:

```bash
command -v omm || npm install -g github:al-kheder/omm
```

If the install command fails (permission denied), tell the user:
"Please run `npm install -g github:al-kheder/omm` in your terminal, then try again."

## Workflow

### Step 1: Check Login Status

Run `omm share` via Bash. If it errors with "not logged in":
- Tell the user: "You need to log in first."
- Run `omm login` — this opens a browser for GitHub OAuth
- Wait for the user to complete login

### Step 2: Check Project Link

Run `omm share` via Bash. If it errors with "no project slug":
- Run `omm link` — this sets the cloud project slug from the directory name
- Confirm: "Linked to {slug}"

### Step 3: Push

Run `omm push` via Bash.

Handle errors:
- **401 Unauthorized**: "Login expired. Run `omm login` again."
- **403 Forbidden**: report the server's message as-is (for example a plan or permission limit).
- **Network error**: "Cannot reach server. Check your connection and OMM_API_URL."

### Step 4: Report

On success, output:
- Number of files uploaded
- The view URL printed by `omm push`
- "Run `omm share` to get the project URL"

## Rules

- Always check login before pushing
- Always check link before pushing
- Do NOT skip steps — each depends on the previous
- If any step fails, stop and report the error with guidance
