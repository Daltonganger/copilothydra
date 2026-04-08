Review only the changes introduced by the current pull request.

Use the checked-out merge commit and the fetched Git refs to inspect the PR diff and commit range.

Be generous in coverage, but prioritize signal over nits. Focus on:
- correctness and regressions
- risky edge cases or missing validation
- tests or docs that are now inaccurate or missing
- security or data integrity issues
- release/CI mistakes that could break packaging, publishing, or review automation

Return structured review output that matches the configured JSON schema.

Authoring rules:
- `event` must be `REQUEST_CHANGES` when at least one issue should be fixed before merge; otherwise use `COMMENT`.
- `summary` should be concise Markdown for the PR timeline review.
- If no material issues are found, set `event` to `COMMENT`, set `summary` exactly to `No blocking issues found.`, and return an empty `comments` array.
- Add inline comments only for high-signal findings that you can anchor to an exact changed line in the PR diff.
- Prefer at most 8 inline comments total.
- Each inline comment must include `path`, `line`, `side`, and `body`.
- Use `side: RIGHT` for added lines and `side: LEFT` for deleted lines.
- Each inline comment body must explain why it matters and suggest the smallest practical fix.
- If an issue is real but cannot be safely anchored to a changed line, keep it in `summary` instead of `comments`.
- Do not praise the PR and do not summarize unchanged code.
