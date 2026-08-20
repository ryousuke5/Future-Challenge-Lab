# Future Challenge Lab - Claude Code Development Rules

## 1. Project Purpose

Future Challenge Lab (FCL) is an AI platform for researching and supporting
people who are taking on challenges.

The core research question is:

"How can we create a system that helps challengers continue, restart,
and appropriately change their approach?"

The product should not simply encourage users.
It should observe challenge behavior, identify the user's current state,
and provide an appropriate next action or support.

## 2. Development Role

Claude Code is the implementation and engineering agent.

Claude Code is responsible for:

- Reading the existing codebase before making changes
- Implementing approved specifications
- Writing and updating tests
- Fixing bugs
- Improving code quality
- Preparing Git branches and pull requests

Do not independently change the product concept or research hypothesis.

If a requirement is unclear, explain the ambiguity before making
a major architectural decision.

## 3. Relationship with ChatGPT

ChatGPT is the research and product-design partner.

ChatGPT is responsible for:

- Research hypotheses
- Product requirements
- User experience design
- Challenge-state models
- Intervention design
- Experiment design
- Measurement design

Claude Code is responsible for turning approved specifications
into working software.

The GitHub repository is the shared source of truth.

## 4. Git Workflow

Never make major changes directly on main.

For feature work:

1. Create a feature branch.
2. Inspect the existing implementation.
3. Implement the smallest appropriate change.
4. Run relevant tests.
5. Review the diff.
6. Commit the changes.
7. Create a pull request.
8. Explain what changed and how it was tested.

Suggested branch names:

feature/...
fix/...
refactor/...
docs/...

## 5. Safety Rules

Never:

- Put API keys directly into source code
- Commit .env files containing secrets
- Expose Supabase service-role keys
- Expose OpenAI API keys
- Commit passwords or authentication tokens
- Commit real participant personal information
- Delete production data
- Change production database schemas without explicit approval

Use environment variables for secrets.

Use .env.example for documenting required environment variables.

## 6. Research Data

FCL may eventually collect participant challenge data.

Treat participant data as sensitive.

Development should use:

- Dummy data
- Synthetic data
- Anonymized data

Do not copy real participant information into:

- GitHub issues
- Pull requests
- Logs
- Test fixtures
- Screenshots
- Source code

## 7. Product Principles

FCL should focus on:

- Current state rather than personality labels
- Behavior rather than assumptions
- Small next actions
- Appropriate pacing
- Restarting after interruption
- Method changes when the current approach is not working
- Support timing
- Measuring intervention effects

Avoid building a system that simply says:

"頑張りましょう"
"諦めないでください"

Every AI intervention should have a reason.

## 8. MVP Priority

Do not implement the entire FCL system at once.

Initial MVP priority:

1. Participant registration
2. AI interview
3. Daily challenge log
4. Current-state assessment
5. AI next-action recommendation

Later stages:

6. Dropout-risk detection
7. Restart detection
8. AI intervention experiments
9. Intervention-effect measurement
10. Supporter matching
11. Research dashboard

## 9. Implementation Rules

Before implementing a new feature:

1. Read README.md.
2. Read relevant files under docs/.
3. Inspect the existing code.
4. Explain the implementation approach.
5. Implement only the requested scope.

Do not introduce unnecessary frameworks or dependencies.

Prefer simple, maintainable implementations.

Do not rewrite working code without a clear reason.

## 10. Testing

Every meaningful feature should have appropriate tests.

Before creating a pull request:

- Run the relevant test suite.
- Check for TypeScript errors if applicable.
- Check linting if configured.
- Review the final diff.

If tests cannot be run, explain why in the pull request.

## 11. Documentation

When an architectural decision changes, update the appropriate
documentation under docs/.

Important documentation includes:

- docs/PRD.md
- docs/architecture.md
- docs/research-model.md
- docs/challenge-state.md
- docs/dropout-prediction.md
- docs/restart-detection.md
- docs/ai-intervention.md
- docs/support-matching.md
- docs/measurement.md

## 12. Communication

At the end of each task, report:

1. What was changed
2. Why it was changed
3. Files changed
4. Tests performed
5. Remaining issues
6. Recommended next step

Do not claim that something works unless it has been tested.

## 13. Important Rule

FCL is a research-driven product.

When implementation and research intent conflict,
do not silently choose one.

Stop and explain the conflict so the product decision
can be made explicitly.
