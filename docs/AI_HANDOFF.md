# FCL AI HANDOFF

This file is the cross-agent handoff between ChatGPT, Claude Code, and the human owner.

## Operating Rule

GitHub is the project source of truth.

When a task is interrupted, continue from the latest checkpoint in this file.
Do not restart from memory alone.

## Project

- Repository: `ryousuke5/Future-Challenge-Lab`
- Default branch: `main`
- MVP version in README: `0.5.0`
- Runtime: Node.js 24.x
- App: Node/Express + Supabase
- Deployment: Render
- Primary browser identity key: `fcl-user-id`

## Current Verified Repository State

Latest verified commits on `main` before this handoff setup:

- `5873108090f438dfb58715a5ed2b68c90c92a8e7` — fix: clarify FCL email unsubscribe behavior
- `7ac03ad213646611f151903e944958d77ec9b694` — db: add atomic FCL email registration unsubscribe
- `95299fcd4b15c5a77d2b153f15521ed86f06f5b5` — test: add email registration unsubscribe coverage

The repository already contains a `CLAUDE.md` defining Claude's role and security rules.
This file adds the resumable cross-agent state.

## Product / Architecture Baseline

The README describes the unified learning loop:

1. Participant registration
2. Self-determination questionnaire
3. Dropout-risk estimation
4. Restart detection
5. Intervention optimization
6. A/B intervention
7. Action-result storage
8. Learning-event storage
9. Supporter matching
10. Research dashboard

The intervention optimizer currently considers:

- risk band
- self-determination band
- restart state
- overall A/B performance
- same-context A/B performance
- participant historical performance
- exploration

The repository also documents a unified FCL user ID based on `fcl_users.id`.

## Recent Completed Work

- Email registration unsubscribe/removal flow was implemented.
- Database support for atomic email-registration unsubscribe was added.
- Automated coverage for the unsubscribe flow was added.
- Disabled/archive behavior and unified user identity are documented in the README.
- Supporter-candidate status regression and related UI/cache fixes were previously addressed.

These items are repository-history facts, not a claim that the production deployment is currently healthy.

## Active Development Principles

- Quality over speed.
- Prefer measurable behavior over subjective assumptions.
- Do not introduce repeated external API calls for a single user action without a clear reason.
- Preserve data integrity and existing historical data.
- Treat Supabase schema/RLS and production configuration as part of the feature, not an afterthought.
- Any AI decision should be inspectable enough to understand why it was selected.
- Changes that affect experimentation should preserve the ability to evaluate expected value, outcomes, and regressions.

## Current Task

Status: AI collaboration/resume infrastructure setup.

Goal:
Make ChatGPT and Claude able to work on the same FCL repository without losing context when a session is interrupted.

Completed in this setup branch:

- strengthened `CLAUDE.md`
- added this `docs/AI_HANDOFF.md`
- added a PR template requiring implementation/test/handoff information

Next action after this branch is merged:
Connect `ryousuke5/Future-Challenge-Lab` to Claude's GitHub integration / Claude Code, then have Claude read `CLAUDE.md` and `docs/AI_HANDOFF.md` before its first implementation task.

## Resume Checkpoint

When a task is active, replace the section below with the latest checkpoint.

### Checkpoint
- Date:
- Branch:
- Commit:
- Objective:
- Completed:
- Files changed:
- Tests:
- Known issue/blocker:
- Exact next action:

## Validation Rules

Never write "verified", "fixed", or "working" unless the relevant test, runtime check, or deployment check was actually performed.

For production behavior, distinguish clearly between:

- repository code verified
- local test verified
- Render deployment verified
- Supabase runtime verified
- browser/manual flow verified

## Handoff Update Format

At the end of each non-trivial task, update:

### Checkpoint
- Date:
- Branch:
- Commit:
- Objective:
- Completed:
- Files changed:
- Tests:
- Known issue/blocker:
- Exact next action:

Do not delete prior decision history unless it is demonstrably obsolete.
When a decision changes, record the new decision and why.
