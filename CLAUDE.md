# Future Challenge Lab - Claude Code Rules

## Project

Future Challenge Lab (FCL) is an AI platform that researches
and supports people who are taking on challenges.

The core goal is to discover how to help challengers:

- continue
- restart
- adjust their methods
- receive appropriate support at the right time

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

Claude is responsible for implementing approved designs.

GitHub is the shared source of truth.

## Development Workflow

1. Read README.md.
2. Read relevant files under docs/.
3. Inspect the existing code.
4. Explain the implementation approach.
5. Create a feature branch.
6. Implement the requested change.
7. Run relevant tests.
8. Review the diff.
9. Create a Pull Request.

Do not make major changes directly to main.

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

## Task Completion Report

After each task, report:

1. What changed
2. Why
3. Files changed
4. Tests performed
5. Remaining issues
6. Recommended next step

Do not claim something works unless it has been tested.
