# House Rules

- Keep PR descriptions, commit messages and comments concise and brief.
- Change as little as possible to do the job. Reduce the lines that reviewers need to read.
- Git commit messages should follow this classic style:
  https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html
- In code comments, don't name specific callers. They will change over time.
- If CI runs some tests automatically, don't mention the tests in the PR description.

## Go

- Doc comments should follow this official style:
  https://go.dev/doc/comment
- Use t.Context() in new tests.
- Don't panic when you can bubble up an error, even when the case seems unreachable. Third-party packages in particular may introduce new error states later.
