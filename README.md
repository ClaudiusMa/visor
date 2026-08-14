# Tasteware

Tasteware is an open-source, local-first taste system for AI agents. It turns a personal visual or multimedia collection into small, evidence-backed context packets that agents can use while designing.

The collection stays in the software or folder chosen by the user. Tasteware keeps only a normalized catalog, replaceable media observations, explicitly confirmed feedback, and an evidence-linked taste profile.

Tasteware is agent- and model-agnostic. Its interface is a dependency-free CLI plus JSON, JSONL, Markdown, files, stdin, and stdout.

## Source support

The first reference adapter reads an [Eagle](https://eagle.cool/) library directly from disk and treats it as read-only. Eagle is an example source, not a platform dependency.

The catalog contract is source-neutral so adapters for ordinary folders or other asset managers can normalize into the same records. A plain-folder adapter is not implemented yet.

## Setup

Requires Node.js 18 or newer. Video storyboards use the macOS Swift toolchain and AVFoundation; the rest of the CLI is dependency-free.

```sh
git clone git@github.com:ClaudiusMa/tasteware.git
cd tasteware
node bin/taste.mjs init --library /absolute/path/to/your/Eagle.library
node bin/taste.mjs update
```

The local configuration and all personal taste data are ignored by Git. To keep private state outside the checkout, set `TASTEWARE_HOME` to another directory.

## Data boundary

Tasteware does not commit or copy a user's source media. The following local files and directories are ignored:

- `config.json`
- `catalog.jsonl`
- `analysis.jsonl`
- `feedback.jsonl`
- `profile.md`
- `cache/`
- `state/`

Machine observations describe media; they are not treated as preference. Only feedback explicitly confirmed by the user can become a taste signal or confirmed profile principle.

## Core workflow

```sh
# Refresh the normalized catalog from the configured source.
node bin/taste.mjs update

# Export undescribed items for any multimodal agent.
node bin/taste.mjs analysis export --new --limit 20 > /tmp/taste-batch.json

# Import schema-valid neutral observations.
node bin/taste.mjs analysis import /tmp/taste-analysis.json

# Surface a small calibration set.
node bin/taste.mjs review --count 6 --format markdown

# Import only feedback the user explicitly confirmed.
node bin/taste.mjs feedback import /tmp/taste-feedback.json --confirmed

# Export bounded evidence for profile synthesis, then import the approved profile.
node bin/taste.mjs profile export --limit 200 > /tmp/taste-profile-evidence.json
node bin/taste.mjs profile import /tmp/profile.md --confirmed

# Retrieve taste for an external task.
node bin/taste.mjs context "calm mobile onboarding with spatial motion" --limit 6
```

See [`docs/contracts.md`](docs/contracts.md) for the exchange formats and evidence rules.

## Commands

- `init --library <path>` — create local configuration and empty private sidecars.
- `update` — rebuild `catalog.jsonl` from active source records.
- `inspect <id>` — inspect one normalized item and its derived state.
- `storyboard <id|--all> [--frames 6]` — create JPEG storyboards for video references.
- `analysis export [--new] [--limit 20]` — produce a model-neutral analysis batch.
- `analysis import <file>` — validate and merge neutral media observations.
- `feedback import <file> --confirmed` — validate and merge user-confirmed taste signals.
- `profile export` — produce bounded profile-synthesis evidence.
- `profile import <file> --confirmed` — install an approved evidence-linked profile.
- `review [--count 6]` — stratified random sampling for calibration.
- `context <task> [--limit 6]` — return a bounded task-specific taste packet.

All commands return JSON unless `--format markdown` is requested.

## License

MIT
