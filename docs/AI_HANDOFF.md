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

- `7bb23e9c97e7832a6e98003483f228fc21aad558` — fix: show legacy check-in summary (2026-10-19)

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

Status: Product specification prepared on a feature branch; implementation has not started.

Goal:
Define and then implement a private challenge portfolio and evidence-based growth timeline without replacing the existing daily story experience.

Completed:
- Inspected README, CLAUDE.md, AI_HANDOFF, existing Supabase schema/migrations, story.html, user.html, and relevant server.js routes.
- Confirmed that participants can represent multiple challenges per FCL user.
- Confirmed that story.html already provides a date-based narrative timeline.
- Added `docs/07_CHALLENGE_PORTFOLIO_GROWTH_SPEC.md` with product scope, data proposal, API proposal, privacy requirements, acceptance criteria, and rollout metrics.
- Updated this handoff with the product decision and checkpoint.

Next action:
Claude Code must read `CLAUDE.md`, this handoff, and `docs/07_CHALLENGE_PORTFOLIO_GROWTH_SPEC.md`; inspect the local branch/worktree and live Supabase schema/migration history read-only; then implement the smallest additive migration and API/UI changes on a separate implementation branch. Do not change production DB or deploy until migration/security/tests are reviewed.

## Resume Checkpoint

### Checkpoint
- Date: 2026-10-31
- Branch: `feat/challenge-portfolio-growth-spec-20261031`
- Base main commit: `7bb23e9c97e7832a6e98003483f228fc21aad558`
- Spec commit before this handoff update: `243b9c20a520803028b4dfb0b07af6355f641020`
- Objective: Define the FCL challenge portfolio and evidence-based growth timeline.
- Completed: Repository source inspection; product decision recorded; implementation spec added.
- Files changed: `docs/07_CHALLENGE_PORTFOLIO_GROWTH_SPEC.md`; `docs/AI_HANDOFF.md`.
- Tests: Not run; documentation-only changes. No app code, migration, live DB, or Render deployment was changed.
- Known issue/blocker: Local working tree and live Supabase schema/runtime were not inspected in this session. Validate before implementation.
- Exact next action: Claude Code to inspect local state and live schema, then implement Phase 1 of the spec on a separate feature branch.

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
