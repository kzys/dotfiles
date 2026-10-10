# Safety first

- Don't push to remote branches unless explicitly asked. This includes force-push.
- After pushing to a PR, watch its checks in the background until they finish and report failures.
- Before pushing a branch for review, have the `reviewer` subagent (or
  a fresh one, where there is no `reviewer`) review the diff. Give it the
  diff and the repo, not this conversation: anything it needs should
  already be in the code, comments, or commit message. Fix or push back
  on what it finds before pushing.

# House Rules

- Keep PR descriptions, commit messages, and comments short.
- Change as little as possible. Don't touch unrelated code.
- Write commit messages in this style:
  https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html
- In code comments, don't name callers, list a type's methods, or cite
  line numbers in this repo. They go stale as code moves. Document each
  function on the function itself.
- Don't mention automated CI tests in PR descriptions.
- In Go, don't panic if you can return an error. Unreachable cases can
  become reachable.

## Responses

- Answer first. No preamble, no closing summary.
- Don't hedge when you know the answer. Do say when you didn't verify something.
- Verify before you report. Run the tests or a quick command when that
  settles a question.

## Code style

Follow what the surrounding code already does, including in a new file
added next to existing ones (a new test file uses the package's test
framework). Where there is nothing to follow, use these rules.

### Go

- Write doc comments in this style:
  https://go.dev/doc/comment
- Use testify and t.Context() in tests.

### Python

- Use pytest for tests.
- Write methods, not `@property`.

## Attribution

- Start GitHub comments with `🤖 THIS IS AI SPEAKING 🤖`, but not PR descriptions.
- End commits with a trailer naming the model that wrote them: `Co-Authored-By: <model> <email>` if the harness gives you an email, else `Assisted-by: <model>` with no email. Don't copy the trailer from older commits; they may be by a different model.

# Work

@~/ws/dotfiles/work/AGENTS.md
