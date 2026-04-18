---
name: review-as-me
description: Use when the user says "review as me", "review like me", or "review this PR as <username>". Applies the user's personal review style and mandatory guidelines to a pull request, then optionally posts inline comments.
---

# Review As Me

Perform a code review as the current user, applying their personal review guidelines stored at `~/.review-as-me/review-guidelines.md`.

## Step -1 — Setup Check

Check if `~/.review-as-me/server.js` exists.

If it does **not** exist, locate `setup.sh` in the same directory as this skill file and run it automatically:

```bash
bash <skill-dir>/setup.sh
```

Then continue — no need to pause or notify the user.

## Step 0 — Load Guidelines

**Before anything else**, read the guidelines file:

```
~/.review-as-me/review-guidelines.md
```

If it doesn't exist, ask the user to create it before proceeding.

This is the mandatory ruleset. Every section in it MUST be checked. You may also flag issues beyond the guidelines.

## Step 1 — Eligibility Check (Haiku agent)

Check if the PR is:
- (a) closed or merged
- (b) a draft
- (c) trivial/automated (no real review needed)
- (d) already reviewed by the current GitHub user — run `gh api user --jq .login` to get the username (skip bot reviews)

If any of (a)-(d): stop.

## Step 2 — PR Summary (Haiku agent)

Fetch the PR with `gh pr view <number> --repo <owner/repo>` and `gh pr diff`.
Return: title, description, list of files changed, and a concise summary.

## Step 3 — 5 Parallel Review Agents (Sonnet)

Launch all 5 at once. Each returns a list of issues with file, line, description, and confidence reason.

- **Agent 1 — Guidelines audit**: Apply every section of `~/.review-as-me/review-guidelines.md` against the diff. Flag violations with the specific rule quoted.
- **Agent 2 — Bug scan**: Shallow scan of diff for obvious logic bugs, crashes, missing guards. Ignore nitpicks.
- **Agent 3 — Git history**: Check git blame/log on modified files. Flag issues that only make sense with historical context.
- **Agent 4 — Previous PR comments**: Find recent merged PRs touching same files. Check their review comments for patterns that apply here.
- **Agent 5 — Code comments compliance**: Read comments in modified files (TODOs, WARNINGs, architectural notes). Flag violations.

## Step 4 — Score Each Issue (parallel Haiku agents)

One agent per issue. Score 0–100:

| Score | Meaning |
|-------|---------|
| 0 | False positive, pre-existing, or doesn't hold up |
| 25 | Might be real but unverified; stylistic without explicit guideline backing |
| 50 | Verified real but minor/nitpick |
| 75 | Verified real, important, will be hit in practice, or directly in guidelines |
| 100 | Definitely real, confirmed, happens frequently |

For guideline-flagged issues: agent must confirm the guideline actually covers it.

**Filter: keep only issues scoring ≥ [CURRENT_THRESHOLD].** Read the current threshold from `~/.review-as-me/review-threshold.json` before filtering. If the file doesn't exist, use **50** as the default and create it.

## Step 5 — Final Eligibility Re-check (Haiku agent)

Confirm PR is still open and not already reviewed by the current GitHub user.

## Step 6 — Save Review File

Before presenting results, save (or overwrite) the review to:

```
~/.review-as-me/reviews/{owner}-{repo}-pr-{number}.md
```

Create `~/.review-as-me/reviews/` if it doesn't exist. Use this exact table format:

```markdown
# PR Review: #{number} — {title}

**Repo:** {owner}/{repo}
**Branch:** `{branch}`
**Author:** {author}
**SHA:** `{full-sha}`
**Reviewed as:** {github-username}
**State legend:** `pending` · `accept` · `reject` · `edited`
**Published legend:** `no` · `yes`

---

## Issues

| # | State | Published | Score | Category | Issue | File |
|---|-------|-----------|-------|----------|-------|------|
| 1 | pending | no | 100 | Security | <issue summary> | `<file path>` |
| 2 | pending | no | 75 | Bug | <issue summary> | `<file path>` |
...

---

## Notes

<any blocking issues or high-priority notes>
```

- `State` tracks the reviewer's decision: `pending` → `accept` / `reject` / `edited`
- `Published` tracks whether the comment was posted to GitHub: starts as `no`, set to `yes` after posting

## Step 7 — Present Results

Present all issues to the user clearly (file, line link with full SHA, description, which guideline rule or reason).

Ask: "Should I post this as a comment on the PR?"

If yes, post using `gh api POST /repos/{owner}/{repo}/pulls/{number}/reviews` with each issue as an inline comment at its exact line — **never as a single top-level PR comment**. Use the `comments` array in the review payload, with `path`, `line`, `side: "RIGHT"`, and `body` per issue. Fetch the exact line numbers from the file at the PR head commit before posting. Use `event: "REQUEST_CHANGES"`.

After posting, update the `Published` column to `yes` for every issue that was included in the posted comment, then save the file again.

## Step 8 — Cross-check Published Comments

After posting and updating the file, verify the comments actually landed on GitHub:

1. Fetch the review comments via CLI:
   ```
   gh pr view <number> --repo <owner/repo> --comments
   ```
2. For each issue marked `Published: yes`, confirm its comment body appears in the output.
3. If any are missing, report which ones failed and set their `Published` back to `no` in the file.
4. If all are present, confirm to the user: "All N comments verified on GitHub."

## Output Format

```
### Code review (as {github-username})

Found N issues:

1. <brief description> (Guidelines: "<exact rule quoted>")

https://github.com/<owner>/<repo>/blob/<full-sha>/<file>#L<start>-L<end>

2. <brief description> (bug: <reason>)

https://github.com/<owner>/<repo>/blob/<full-sha>/<file>#L<start>-L<end>
```

If no issues ≥ 75: "No issues found. Checked against personal guidelines and scanned for bugs."

## After the Review — Self-Improvement Loop

After presenting results (and optionally posting the comment), always run this loop:

### 1. Extract Candidate Learnings

Analyse the review session and identify anything worth adding to the guidelines:
- **New patterns** the reviewer flagged that aren't in the guidelines yet
- **False positives** that reveal a rule needs tightening or clarification
- **Tone or phrasing** patterns from the reviewer's actual comments
- **Architectural decisions** that seem load-bearing for this codebase
- **Rules that proved irrelevant** — candidates for removal or scoping

### 2. Draft Proposed Changes

For each candidate, draft the exact text to add, edit, or remove in `~/.review-as-me/review-guidelines.md`.

Format each proposed change clearly:

```
Proposed addition to "## [Section Name]":
> <exact text to add>

Reason: <why this is worth adding based on what we saw>
```

Or for edits:

```
Proposed edit in "## [Section Name]":
  Current: <existing text>
  Replace with: <new text>

Reason: <what was wrong or incomplete>
```

Or for removals:

```
Proposed removal from "## [Section Name]":
> <text to remove>

Reason: <why this rule is redundant, too broad, or no longer accurate>
```

### 3. Ask for Approval — One Change at a Time

Present each proposed change individually and ask:

> "Should I add this to the guidelines? (yes / no / edit)"

- **yes** → apply immediately to the file
- **no** → skip, do not apply
- **edit** → user provides revised wording, apply that instead

**Never batch-apply changes.** Each change must be explicitly approved.

### 4. Apply Approved Changes

Write approved changes directly to `~/.review-as-me/review-guidelines.md`:
- New learnings go under `## Learnings from Past Reviews` with the PR reference
- Edits to existing rules are made in-place in the relevant section
- Removals delete the flagged text

Confirm each write: "Updated. [section name] now reads: `<new text>`"

### 5. Record Issue Outcomes for Threshold Calibration

After the user decides whether to post the comment (or after presenting results if not posting), ask:

> "Were there issues I flagged that you felt were noise? Or issues I missed that you would have caught? (yes / no)"

If yes, ask them to describe briefly. Record this in `/Users/navayuvan/.claude/review-threshold.json` under `feedback`.

### 6. Auto-Adjust Threshold

After each review session, recalculate the threshold based on cumulative feedback history in `review-threshold.json`:

**Signal sources:**
- **Too much noise** (user rejects flagged issues, says "this is a false positive"): nudge threshold **up** by 2–5 points
- **Missed issues** (user says "you should have caught X"): nudge threshold **down** by 2–5 points
- **Approved issues** (user says "yes post this" or approves the comment): reinforce current threshold (no change)
- **Rejected full comment** ("don't post this, these aren't real issues"): nudge threshold **up** by 5 points

**Rules:**
- Never go below **30** (floor — avoids missing too much)
- Never go above **85** (ceiling — avoids becoming too silent)
- Change in single session: max ±10 points total
- Always write the new threshold back to `review-threshold.json` with a log entry

**Format of `review-threshold.json`:**
```json
{
  "threshold": 50,
  "log": [
    {
      "date": "2026-04-16",
      "pr": "mangoleaphq/gallabox#6439",
      "previous": 50,
      "new": 50,
      "reason": "Initial value"
    }
  ]
}
```

After adjusting, tell the user:
> "Threshold updated: [old] → [new]. Reason: [brief reason]."

### 7. Skip If Nothing New

If the review produced no new patterns worth capturing in the guidelines, say so briefly:
"Nothing new to add to the guidelines from this review."

Do not manufacture learnings. Only propose changes when there is genuine signal from the review.

## Key Rules from Guidelines (quick ref)

- Schema definition order: schemadef before Schema
- No `any` casts — always question why
- Resolve complex DB types to primitives at layer boundaries; don't pass as separate params
- Hardcoded string identifiers → enums/constants
- `resolveAgentPrompt`-style logic belongs at the correct abstraction layer
- Question necessity of new optional fields: "Do we need this? Is it mandatory?"
- Avoid unnecessary re-exports
- Mongoose schemas: SchemaDefV2 + EmbeddedSchema
- Use domain-specific loggers, not generic logger
- Single responsibility per job
- `matchedData` in controllers, not manual extraction
