# Tasteware

Tasteware lets an AI agent use your visual references while it designs.

Your images and videos stay in your own library. Tasteware reads that library, helps you record what you like or want to avoid, and returns a small set of relevant references for each task.

> **Current version:** Eagle libraries are supported. Ordinary folders and other mood-board tools are next.

## 1. Install

Tasteware requires Node.js 18 or newer.

```sh
git clone https://github.com/ClaudiusMa/tasteware.git
cd tasteware
npm link
```

`npm link` installs the `taste` command. To avoid installing it, replace `taste` below with `node bin/taste.mjs` and run the command from this repository.

## 2. Connect your library

Point Tasteware at your Eagle library. Do not copy the library into this repository.

```sh
taste init --library "/absolute/path/to/Your Library.library"
taste update
```

Whenever the library changes, refresh the catalog:

```sh
taste update
```

Tasteware reads the library without modifying it.

## 3. Use your references

Describe what you are making:

```sh
taste context "editorial poster with expressive typography" --format markdown
```

Or tell the agent working on your design:

```text
Run `taste context "<describe this design task>" --format markdown`.
Inspect only the returned references. Use confirmed preferences as direction,
cite the reference IDs you used, and do not modify my source library.
```

Tasteware returns only a small task-specific set of references—not the complete library.

## 4. Teach Tasteware your taste

A saved image is a reference, not proof that you like every part of it. Tasteware learns through review and explicit confirmation.

Start a review:

```sh
taste review --count 6 --format markdown
```

Ask your agent to show you those references and ask what you like or want to avoid. After you confirm, it should create a file matching [`examples/feedback.json`](examples/feedback.json) and import it with:

```sh
taste feedback import <feedback.json> --confirmed
```

For optional visual analysis and profile-building workflows, see [`docs/contracts.md`](docs/contracts.md).

## 5. Connect it to a knowledge system

Add this instruction to the knowledge system's agent instructions:

```text
When a task involves visual design, run `taste context "<task>" --format markdown`.
Use only the returned taste packet. Do not scan or copy the complete visual library.
Treat confirmed feedback as preference and media observations as description only.
```

Tasteware is designed to work alongside the open-source [Personal Knowledge System](https://github.com/ClaudiusMa/Personal-Knowledge-System), but it can be called from any agent workspace or terminal.

## Privacy

Your source library is read-only and is never committed to this repository. Tasteware's personal configuration, catalog, analysis, feedback, profile, cache, and review history are also excluded by `.gitignore`.

Run `taste --help` for every available command. Tasteware is licensed under the MIT License.
