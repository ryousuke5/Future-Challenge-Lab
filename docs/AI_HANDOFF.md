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

Latest verified commit on `main` at the time of this handoff update:

- `ce8ff1bd44a1747f743e7098b178c55217890fd9` — merge PR #22, challenge portfolio and growth timeline specification (2026-10-31)

The repository includes a `CLAUDE.md` defining Claude's implementation role, startup sequence, security rules, branch workflow, and handoff requirements.

Important limitation: this checkpoint was inspected through the GitHub repository API. It does not verify a local working tree, Render deployment, or the live Supabase schema/runtime.

## Product / Architecture Baseline

The README describes the existing unified learning-loop research MVP:

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

The intervention optimizer currently considers risk band, self-determination band, restart state, overall and same-context A/B performance, participant history, and exploration.

The repository uses `fcl_users.id` as the common FCL user ID. `participants` rows represent challenger registrations and can contain multiple challenges for one user.

The current `public/story.html` already builds a date-based challenge narrative from check-ins, action results, model-learning events, supporter connections, and journal replies. `challenge_story_pages` and `life_story_pages` are also present. Do not build a duplicate daily diary/timeline or remove this existing story experience.

## Product Direction Decision — 2026-10-31

The owner selected this as FCL's primary user value:

**Users choose FCL because their growth and challenge outcomes accumulate over time.**

Initial target:
- Company employees, initially centered on ages 30–40, who have already published at least one note/blog article as a side project.
- They want to continue their side project but their outputs, learning, failures, and improvement history are scattered or difficult to review.

Product concept:
- FCL is a private, evidence-based challenge portfolio.
- Capture meaningful outcomes, work samples, learning, setbacks, method changes, pauses, and restarts when they occur. Do not require daily check-ins.
- Provide an evidence-based growth reflection that explains what changed and links back to source records.
- Let past challenge experience inform later challenges.

Key distinctions:
- Existing `story.html`: daily/date-based narrative and journal history.
- New portfolio: curated outcomes and evidence across a challenge, with AI reflection grounded in the saved records.
- Keep all new portfolio records private by default. Do not auto-publish them through `challenge_stories`.

The detailed approved product/implementation proposal is:
- `docs/07_CHALLENGE_PORTFOLIO_GROWTH_SPEC.md`

This is a product specification only. No application code or production database has been changed by this task.

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

Status: Product specification merged; implementation task opened as GitHub Issue #23. Application implementation has not started.

Goal:
Implement a private challenge portfolio and evidence-based growth timeline that makes accumulated outcomes, artifacts, setbacks, learning, and observed changes useful to the user.

Product decision:
- Core value: users use FCL because their growth and challenge outcomes accumulate over time.
- Initial audience: employees who have already published at least one note/blog article as a side project.
- Existing `public/story.html` remains the day-by-day personal narrative. The new portfolio is a curated set of outcomes and evidence, not a duplicate daily timeline.
- Daily check-in is not required.
- AI growth analysis must be user-triggered and trace every claim to stored evidence.

Completed:
- PR #22 merged into `main`.
- Added `docs/07_CHALLENGE_PORTFOLIO_GROWTH_SPEC.md`.
- Created GitHub Issue #23 with implementation scope, acceptance criteria, and handoff instructions.
- Read-only inspection of the connected Supabase project found the existing FCL tables, including `participants`, `action_results`, `challenge_story_pages`, `challenge_stories`, `journal_entries`, `journal_replies`, `personal_ai_profiles`, and `fcl_users`.
- Confirmed RLS is enabled on inspected existing tables. `participants`, `action_results`, `challenge_stories`, `journal_entries`, `journal_replies`, and `fcl_users` have `deny_direct_api_access`; `challenge_story_pages` and `personal_ai_profiles` have service-role policies.
- Confirmed `challenge_records` and `challenge_growth_snapshots` do not yet exist in the connected database.
- Observed that the live migration-history listing is not a one-to-one match with every checked-in migration filename. This must be reconciled before any migration is applied.

Next action:
Claude Code should take Issue #23, inspect the local worktree and live migration history, run `supabase migration new challenge_portfolio_growth` locally to create the timestamped migration, then implement on a feature branch. Do not apply DDL to production, reset the remote database, or deploy Render until the migration, API ownership checks, RLS, and tests have been reviewed.

## Resume Checkpoint

### Checkpoint
- Date: 2026-10-31
- Branch: `chore/portfolio-implementation-handoff-20261031` (handoff update branch)
- Base commit: `ce8ff1bd44a1747f743e7098b178c55217890fd9`
- Objective: Prepare implementation handoff after merging the portfolio/growth product specification.
- Completed: Verified PR #22 is merged; inspected live Supabase table inventory, relevant columns, RLS status, and migration history read-only; opened Issue #23.
- Files changed: `docs/AI_HANDOFF.md` only.
- Tests: Not run; documentation-only handoff update. No application code, production DB, or Render service changed.
- Known issue/blocker: Live Supabase migration history does not match all checked-in migration filenames one-to-one; Claude must reconcile before writing/applying a migration. No local working tree or Node test suite was available in this session.
- Exact next action: Claude Code to begin Issue #23 on a separate implementation branch, starting with read-only local/live migration reconciliation.

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
