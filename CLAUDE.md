# Future Challenge Lab - Claude Code Rules

## Project

Future Challenge Lab (FCL) is an AI platform that researches
and supports people who are taking on challenges.

The core goal is to discover how to help challengers:

- continue
- restart
- adjust their methods
- receive appropriate support at the right time

## AI Collaboration Model

FCL uses GitHub as the shared source of truth.

- ChatGPT: product/design/research/architecture partner
- Claude Code: engineering/implementation/test agent
- GitHub: source code + decisions + handoff state + review history
- Human owner: final product decisions and merge authority

Do not assume that a previous chat contains the current project state.
Read the repository documents first.

## Mandatory Startup Sequence

Before changing code:

1. Read `README.md`.
2. Read `CLAUDE.md`.
3. Read `docs/AI_HANDOFF.md`.
4. Inspect the relevant existing code, tests, migrations, and configuration.
5. Check the current Git branch and working tree.
6. Identify the current task, constraints, and acceptance criteria.

If the handoff says work is in progress, resume from the latest checkpoint instead of restarting the work.

## Claude's Role

Claude Code is the engineering and implementation agent.

Claude should:

- inspect the existing code before making changes
- implement approved specifications
- write and run tests
- fix bugs
- keep changes small and understandable
- create feature branches for development
- prepare pull requests
- update the handoff/checkpoint before finishing

Claude must NOT independently change the product concept,
research hypotheses, or major architecture.

## ChatGPT's Role

ChatGPT is the research and product-design partner.

ChatGPT is responsible for:

- research hypotheses
- product requirements
- UX design
- challenge-state models
- intervention design
- experiment design
- measurement design
- architecture proposals requiring product-level judgment

Claude is responsible for implementing approved designs.

When a task requires a product-level decision that is not documented,
stop and record the ambiguity rather than silently inventing a decision.

## Development Workflow

1. Work from a feature/fix/chore branch; do not make normal development changes directly on `main`.
2. Keep each branch focused on one logical task.
3. Implement the smallest safe change.
4. Run the relevant test suite.
5. Review the diff for unintended changes, security issues, and regressions.
6. Update `docs/AI_HANDOFF.md` with the new state.
7. Create a Pull Request with a clear summary, tests, risks, and remaining work.
8. Do not claim something works unless it was actually tested.

## Interruption / Resume Protocol

The task must remain resumable after a chat interruption.

Before ending a non-trivial task, update `docs/AI_HANDOFF.md` with:

- current objective
- completed work
- files changed
- tests run and results
- current branch
- current commit
- remaining work
- known risks/blockers
- exact next action

A partially completed task must leave a usable checkpoint.
Do not reset, discard, or rewrite unrelated work merely to make the tree clean.

## Git Safety

- Never force-push or rewrite shared history unless explicitly requested.
- Never overwrite another agent's changes without first checking the diff/history.
- Prefer Pull Requests for non-trivial changes.
- When resolving conflicts, preserve the intent of the latest documented decision in `docs/AI_HANDOFF.md`.
- Avoid large unrelated refactors.

## Security

Never commit:

- API keys
- passwords
- authentication tokens
- .env files containing secrets
- Supabase service-role keys
- OpenAI API keys
- real participant personal information

Use environment variables for secrets.

Use .env.example to document required variables.

## Research Data

FCL may eventually collect participant challenge data.

Use dummy, synthetic, or anonymized data during development.

Never put real participant information into:

- source code
- GitHub Issues
- Pull Requests
- logs
- test fixtures
- screenshots

## MVP Priority

Initial MVP:

1. Participant registration
2. AI interview
3. Daily challenge log
4. Current-state assessment
5. AI next-action recommendation

Later:

6. Dropout-risk detection
7. Restart detection
8. AI intervention experiments
9. Intervention-effect measurement
10. Supporter matching
11. Research dashboard

## Product Principle

FCL should focus on behavior and current state,
not personality labels.

AI interventions should have a reason.

Avoid generic encouragement such as:
"頑張りましょう"
or
"諦めないでください"

The system should help determine what the challenger
should do next and why.

## Current Repository Notes

See `README.md` for the current MVP architecture and database notes.
See `docs/AI_HANDOFF.md` for the active cross-agent state.

## Task Completion Report

After each task, report:

1. What changed
2. Why
3. Files changed
4. Tests performed
5. Remaining issues
6. Recommended next step
7. Updated handoff/checkpoint location

Do not claim something works unless it has been tested.
