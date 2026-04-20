# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual `SKILL.md` files.

## Project
- Name: GRUAMAN-BOMBERMAN-BACK
- Generated: 2026-04-11
- Source: sdd-init

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When creating a pull request, opening a PR, or preparing changes for review. | branch-pr | C:/Users/santi/.codex/skills/branch-pr/SKILL.md |
| When writing Go tests, using teatest, or adding test coverage. | go-testing | C:/Users/santi/.codex/skills/go-testing/SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature. | issue-creation | C:/Users/santi/.codex/skills/issue-creation/SKILL.md |
| When user says "judgment day", "judgment-day", "review adversarial", "dual review", "doble review", "juzgar", "que lo juzguen". | judgment-day | C:/Users/santi/.codex/skills/judgment-day/SKILL.md |
| When user asks to create a new skill, add agent instructions, or document patterns for AI. | skill-creator | C:/Users/santi/.codex/skills/skill-creator/SKILL.md |
| Generate or edit raster images when the task benefits from AI-created bitmap visuals. | imagegen | C:/Users/santi/.codex/skills/.system/imagegen/SKILL.md |
| Use when the user asks how to build with OpenAI products or APIs and needs up-to-date official documentation with citations. | openai-docs | C:/Users/santi/.codex/skills/.system/openai-docs/SKILL.md |
| Use when Codex needs to create a new local plugin, add optional plugin structure, or update marketplace entries. | plugin-creator | C:/Users/santi/.codex/skills/.system/plugin-creator/SKILL.md |
| Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo. | skill-installer | C:/Users/santi/.codex/skills/.system/skill-installer/SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### branch-pr
- Every PR MUST link an approved issue before opening it.
- Every PR MUST have exactly one `type:*` label.
- Use conventional commits only; never add `Co-Authored-By`.
- Branch names MUST match `type/description` in lowercase.
- Use the PR template and include linked issue, summary, changes table, and test plan.
- Required checks must pass before merge.

### go-testing
- Prefer table-driven tests for pure or parameterized Go logic.
- Test Bubbletea state transitions by calling `Model.Update()` directly.
- Use `teatest.NewTestModel()` for interactive TUI flows.
- Use golden files for stable view/output assertions.
- Use `t.TempDir()` for filesystem tests and mock side effects behind interfaces.
- Cover both success and error paths explicitly.

### issue-creation
- Always use the repository issue templates; blank issues are disabled.
- Search for duplicates before creating a new issue.
- New issues start as `status:needs-review`; implementation waits for `status:approved`.
- Questions belong in Discussions, not Issues.
- Bug reports need repro steps, expected vs actual behavior, platform, client, and shell.
- Feature requests need problem, proposal, and affected area.

### judgment-day
- Use only when the user explicitly asks for adversarial dual review.
- Launch two blind judges in parallel with the same target and standards.
- Resolve compact rules from the skill registry before launching judges.
- Synthesize findings by confirmed, suspect, or contradiction.
- Fix only confirmed issues, then re-judge if confirmed CRITICALs remain.
- After two fix rounds, escalate to the user if issues persist.

### skill-creator
- Create a skill only for reusable patterns, not one-off tasks.
- Keep skill names lowercase and hyphenated.
- `SKILL.md` frontmatter must include `name`, `description` with trigger, license, author, and version.
- Put reusable templates in `assets/` and local docs links in `references/`.
- Keep examples minimal and actionable.
- Register new project skills in `AGENTS.md` after creating them.

### imagegen
- Use the built-in image generation path by default; CLI fallback is explicit-only.
- Prefer raster generation/editing only when bitmap output is actually the right medium.
- For local edit targets on the built-in path, load the image into context first.
- Keep project-bound outputs inside the workspace, not only in Codex generated paths.
- Do not overwrite existing assets unless the user explicitly asks.
- Report final saved path, final prompt, and whether built-in or CLI mode was used.

### openai-docs
- For OpenAI product questions, prioritize official OpenAI docs tools over generic web search.
- Use bundled references only as helper context; current docs stay authoritative.
- Restrict fallback browsing to official OpenAI domains.
- Cite the exact relevant docs page or section.
- For model or GPT-5.4 upgrade questions, verify recommendations against current docs.
- If docs do not answer the need, say so explicitly and propose next steps.

### plugin-creator
- Scaffold plugins with the helper script; do not hand-roll the structure.
- Always keep `.codex-plugin/plugin.json` present with normalized plugin name.
- Use placeholders until the user explicitly fills manifest details.
- Marketplace entries must include installation policy, authentication policy, and category.
- Preserve existing marketplace metadata and ordering unless the user asks otherwise.
- Use `--force` only for intentional replacement.

### skill-installer
- Use the helper scripts to list or install skills; do not manually copy files.
- Listing defaults to curated skills unless the user asks for experimental ones.
- Installing from network-backed sources requires escalation when sandboxed.
- Abort instead of overwriting an existing installed skill.
- System skills are already preinstalled; explain that before reinstalling them.
- After install, tell the user to restart Codex.

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| AGENTS.md | C:/Users/santi/Documents/Gruas y Equipos/1. desarrollo/GRUAMAN-BOMBERMAN-BACK/AGENTS.md | Project instruction index: architecture, behavior, SDD workflow, and strict TDD preference. |
| .atl/skill-registry.md | C:/Users/santi/Documents/Gruas y Equipos/1. desarrollo/GRUAMAN-BOMBERMAN-BACK/.atl/skill-registry.md | Referenced by `AGENTS.md` as the project skill registry consumed by delegators. |

Read the convention files listed above for project-specific patterns and rules.
