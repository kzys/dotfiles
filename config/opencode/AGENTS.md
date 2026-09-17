# Safety first

- Don't push to remote branches unless explicitly asked. This includes force-push.

# House Rules

- Keep PR descriptions, commit messages, and comments short.
- Change as little as possible. Don't touch unrelated code.
- Write commit messages in this style:
  https://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html
- Don't name specific callers in code comments. Callers change.
- Don't mention automated CI tests in PR descriptions.

## Responses

- Answer first. No preamble, no closing summary.
- Don't hedge when you know the answer. Do say when you didn't verify something.

## Go

- Write doc comments in this style:
  https://go.dev/doc/comment
- Use t.Context() in new tests.
- Don't panic if you can return an error. Unreachable cases can become reachable.

## Attribution

- Start GitHub comments with `:robot: THIS IS AI SPEAKING :robot:`.
- End commits with a trailer naming the model that wrote them: `Co-Authored-By: <model> <email>` if the harness gives you an email, else `Assisted-by: <model>` with no email. Don't copy the trailer from older commits; they may be by a different model.
