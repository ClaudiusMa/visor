# AGENTS.md

Visor owns the user's visual-context and taste system. Its subject is visual context, not knowledge management or product execution.

Start with `README.md`. The portable `visor` CLI is the supported interface for external agents.

Operating boundaries:

- Treat external media sources, including `Eagle.library`, as read-only.
- Keep external media in its source library. User-managed media may live in the ignored local `library/` folder.
- Machine observations describe media; they are not evidence of the user's preference.
- Only explicitly confirmed feedback may become a taste signal or a confirmed profile principle.
- Keep item IDs and evidence links intact through analysis, review, profile synthesis, and retrieval.
- Return bounded, task-specific context. Never send the complete catalog to an agent.
- Store generated storyboards in `cache/`; they are disposable derivatives, not canonical media.
- Do not modify an external knowledge system or product code from this workspace. Other systems may invoke `visor context` and act inside their own scope.
- Do not add an agent-vendor dependency to the core CLI. Exchange analysis and profile work through JSON, Markdown, stdin, stdout, and files.
