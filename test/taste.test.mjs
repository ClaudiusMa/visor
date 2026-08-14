import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "taste.mjs");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ego-test-"));
  const library = path.join(root, "Fixture.library");
  const images = path.join(library, "images");
  fs.mkdirSync(images, { recursive: true });
  fs.writeFileSync(path.join(library, "metadata.json"), JSON.stringify({
    folders: [{ id: "F1", name: "Layout", children: [] }],
  }));
  const records = [
    { id: "A1", name: "Editorial grid", ext: "jpg", folders: ["F1"], tags: ["layout"], isDeleted: false, width: 1200, height: 1600 },
    { id: "B2", name: "Card motion", ext: "mp4", folders: [], tags: [], isDeleted: false, width: 720, height: 720, duration: 8 },
    { id: "C3", name: "Deleted", ext: "jpg", folders: [], tags: [], isDeleted: true },
  ];
  for (const record of records) {
    const directory = path.join(images, `${record.id}.info`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "metadata.json"), JSON.stringify(record));
    fs.writeFileSync(path.join(directory, `${record.name}.${record.ext}`), "fixture");
    fs.writeFileSync(path.join(directory, `${record.name}_thumbnail.png`), "fixture");
  }
  return { root, library };
}

function run(home, args) {
  return JSON.parse(execFileSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, TASTEWARE_HOME: home },
    encoding: "utf8",
  }));
}

test("scan, exchange, review, profile, and context remain bounded", () => {
  const fixture = makeFixture();
  run(fixture.root, ["init", "--library", fixture.library]);
  const update = run(fixture.root, ["update"]);
  assert.equal(update.items, 2);
  assert.deepEqual(update.byKind, { image: 1, video: 1 });

  const batch = run(fixture.root, ["analysis", "export", "--new", "--limit", "1"]);
  assert.equal(batch.items.length, 1);
  const analysisFile = path.join(fixture.root, "analysis-result.json");
  fs.writeFileSync(analysisFile, JSON.stringify({
    schemaVersion: 1,
    items: [{
      id: "eagle:A1",
      summary: "A dense editorial layout.",
      observations: { composition: ["asymmetric grid"], typography: ["large display type"] },
    }],
  }));
  run(fixture.root, ["analysis", "import", analysisFile]);

  const feedbackFile = path.join(fixture.root, "feedback-result.json");
  fs.writeFileSync(feedbackFile, JSON.stringify({
    schemaVersion: 1,
    items: [{ id: "eagle:A1", status: "core", like: ["editorial rhythm"], avoid: ["visual clutter"], useFor: ["layout"] }],
  }));
  const rejected = spawnSync(process.execPath, [CLI, "feedback", "import", feedbackFile], {
    env: { ...process.env, TASTEWARE_HOME: fixture.root }, encoding: "utf8",
  });
  assert.notEqual(rejected.status, 0);
  run(fixture.root, ["feedback", "import", feedbackFile, "--confirmed"]);

  const profileFile = path.join(fixture.root, "approved-profile.md");
  fs.writeFileSync(profileFile, "# Taste Profile\n\n## Layout\n\nPrefer editorial rhythm with explicit hierarchy. Evidence: eagle:A1\n");
  run(fixture.root, ["profile", "import", profileFile, "--confirmed"]);

  const context = run(fixture.root, ["context", "editorial", "layout", "--limit", "1"]);
  assert.equal(context.references.length, 1);
  assert.equal(context.references[0].id, "eagle:A1");
  assert.match(context.profileExcerpt, /editorial rhythm/i);
  assert.equal(context.limits.references, 1);

  const review = run(fixture.root, ["review", "--count", "2", "--seed", "fixed", "--dry-run"]);
  assert.equal(review.items.length, 2);
});
