Review only the changes introduced by the current pull request.

Use the checked-out merge commit and the fetched Git refs to inspect the PR diff and commit range.

Focus on:
- correctness and regressions
- risky edge cases or missing validation
- tests or docs that are now inaccurate or missing
- security or data integrity issues

Output rules:
- Return concise Markdown only.
- If you find issues, use a short bullet list.
- For each issue, include the affected file/path and why it matters.
- Suggest the smallest practical fix.
- If no material issues are found, reply exactly with: No blocking issues found.
- Do not praise the PR and do not summarize unchanged code.
