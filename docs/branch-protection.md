# Branch protection (proposal)

Status: **proposal, not applied.** Changing branch protection or rulesets needs a maintainer's approval.

Goal: humans review everything except record and image changes, which the Sourcing agent may merge when its confidence rules are met.

## Ruleset “main”, target `main`

- Restrict deletions and block force pushes.
- Require linear history; squash merge only (repository setting).
- Require a pull request before merging:
  - 1 approving review;
  - dismiss stale approvals on new commits;
  - require review from Code Owners (`.github/CODEOWNERS`);
  - require conversation resolution.
- Require status checks to pass, branch up to date:
  - `Roastbook · ☕ Cupping (validate)` (validation, actionlint);
  - `Roastbook · 🔥 Roast (build)` (site build);
  - `review-gate` (see below).
- Require signed commits (the GitHub App's API commits are signed by GitHub).
- Bypass list: none. Maintainers merge through pull requests too.

## Bot-allowed flow for records and images

CODEOWNERS leaves `datasets/coffee-places/`, `datasets/i18n/` and `assets/` without owners, so code-owner review does not apply to them. Every other path (`datasets/sources.json`, `scripts/`, `.github/`, `schema-version.txt`, `agent/`, root config) is owned by `@michidk` and needs a human review.

The approving review for an agent pull request comes from auto-merge plus a `review-gate` check in `cupping.yml` that passes only when:

1. the PR author is the Sourcing GitHub App and the diff touches only `datasets/coffee-places/**`, `datasets/i18n/**` and `assets/**`;
2. every changed field has confidence ≥ 0.85 (record `confidence` or `field_provenance.<field>.confidence`);
3. no change sets `status: closed`, changes `specialty_tier`, or cites a source URL on a domain new to the file.

Otherwise the check asks for a human review (label `needs-review`). Because the ruleset requires one approval, the App needs a second identity (a reviewer App limited to approving PRs whose `review-gate` passed), or the approval requirement is relaxed to 0 for PRs whose only changed paths are unowned. Choose one when applying.

## Other settings

- Allow auto-merge: on. Delete head branches after merge: on.
- Private vulnerability reporting: on. Discussions: on. Wiki and projects: off.
- Actions: allow only GitHub-owned, Roastbook and pinned actions; default `GITHUB_TOKEN` permissions read-only.
