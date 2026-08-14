#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_ROOT = process.env.TASTEWARE_HOME
  ? path.resolve(process.env.TASTEWARE_HOME)
  : process.env.EGO_HOME
    ? path.resolve(process.env.EGO_HOME)
    : CODE_ROOT;
const FILES = {
  config: path.join(DATA_ROOT, "config.json"),
  catalog: path.join(DATA_ROOT, "catalog.jsonl"),
  analysis: path.join(DATA_ROOT, "analysis.jsonl"),
  feedback: path.join(DATA_ROOT, "feedback.jsonl"),
  profile: path.join(DATA_ROOT, "profile.md"),
  reviewState: path.join(DATA_ROOT, "state", "reviews.json"),
  storyboards: path.join(DATA_ROOT, "cache", "storyboards"),
};

const OBSERVATION_FIELDS = [
  "composition",
  "typography",
  "color",
  "motion",
  "interaction",
  "mood",
  "material",
  "imagery",
];
const FEEDBACK_STATUSES = new Set(["core", "exploring", "reference-only", "avoid"]);
const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "the", "to", "with",
]);

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgv(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const raw = token.slice(2);
    if (raw.includes("=")) {
      const [key, ...rest] = raw.split("=");
      options[key] = rest.join("=");
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
    } else {
      options[raw] = true;
    }
  }
  return { positional, options };
}

function readJson(filePath, fallback = undefined) {
  if (!fs.existsSync(filePath)) {
    if (fallback !== undefined) return fallback;
    fail(`Missing required file: ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fail(`Invalid JSONL in ${filePath} at line ${index + 1}: ${error.message}`);
      }
    });
}

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
  atomicWrite(filePath, body);
}

function atomicWrite(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, filePath);
}

function loadConfig() {
  const config = readJson(FILES.config);
  if (!Array.isArray(config.sources) || config.sources.length === 0) {
    fail("config.json must contain at least one source");
  }
  return {
    sources: config.sources,
    context: {
      maxItems: positiveInteger(config.context?.maxItems, 6),
      maxProfileWords: positiveInteger(config.context?.maxProfileWords, 1200),
      maxProfileSections: positiveInteger(config.context?.maxProfileSections, 3),
    },
    storyboards: { frames: positiveInteger(config.storyboards?.frames, 6) },
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function isoFromEpoch(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : null;
}

function buildFolderMap(folders, result = new Map(), parents = []) {
  for (const folder of folders || []) {
    const lineage = [...parents, String(folder.name || "Untitled")];
    if (folder.id) result.set(String(folder.id), lineage.join(" / "));
    buildFolderMap(folder.children, result, lineage);
  }
  return result;
}

function itemKind(extension) {
  if (extension === "mp4" || extension === "mov" || extension === "webm") return "video";
  if (extension === "url") return "link";
  return "image";
}

function findMediaFiles(itemDirectory, extension) {
  const files = fs.readdirSync(itemDirectory).filter((name) => name !== "metadata.json");
  const thumbnail = files.find((name) => /_thumbnail\.(png|jpe?g|webp)$/i.test(name));
  const asset = files.find((name) => {
    if (/_thumbnail\./i.test(name)) return false;
    return path.extname(name).slice(1).toLowerCase() === extension.toLowerCase();
  }) || files.find((name) => !/_thumbnail\./i.test(name));
  return {
    assetPath: asset ? path.join(itemDirectory, asset) : null,
    previewPath: thumbnail ? path.join(itemDirectory, thumbnail) : (asset ? path.join(itemDirectory, asset) : null),
  };
}

function scanEagle(libraryPath) {
  const rootMetadata = readJson(path.join(libraryPath, "metadata.json"));
  const folders = buildFolderMap(rootMetadata.folders);
  const imagesDirectory = path.join(libraryPath, "images");
  if (!fs.existsSync(imagesDirectory)) fail(`Eagle images directory not found: ${imagesDirectory}`);
  const records = [];
  for (const entry of fs.readdirSync(imagesDirectory).sort()) {
    if (!entry.endsWith(".info")) continue;
    const itemDirectory = path.join(imagesDirectory, entry);
    const metadataPath = path.join(itemDirectory, "metadata.json");
    if (!fs.existsSync(metadataPath)) continue;
    const metadata = readJson(metadataPath);
    if (metadata.isDeleted === true) continue;
    const sourceId = String(metadata.id || entry.slice(0, -5));
    const extension = String(metadata.ext || "").toLowerCase();
    const media = findMediaFiles(itemDirectory, extension);
    const storyboard = path.join(FILES.storyboards, `${sourceId}.jpg`);
    records.push({
      schemaVersion: 1,
      id: `eagle:${sourceId}`,
      source: "eagle",
      sourceId,
      name: String(metadata.name || sourceId),
      kind: itemKind(extension),
      extension,
      assetPath: media.assetPath,
      previewPath: media.previewPath,
      storyboardPath: fs.existsSync(storyboard) ? storyboard : null,
      sourceUrl: String(metadata.url || ""),
      tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [],
      folderIds: Array.isArray(metadata.folders) ? metadata.folders.map(String) : [],
      folders: Array.isArray(metadata.folders) ? metadata.folders.map((id) => folders.get(String(id))).filter(Boolean) : [],
      width: Number(metadata.width) || null,
      height: Number(metadata.height) || null,
      durationSeconds: Number(metadata.duration) || null,
      palette: Array.isArray(metadata.palettes)
        ? metadata.palettes.map((entryValue) => ({ color: entryValue.color, ratio: entryValue.ratio }))
        : [],
      createdAt: isoFromEpoch(metadata.btime),
      modifiedAt: isoFromEpoch(metadata.mtime || metadata.modificationTime),
    });
  }
  return records;
}

function commandInit(options) {
  const library = options.library;
  if (!library) fail("init requires --library <path>");
  const resolved = path.resolve(String(library));
  if (!fs.existsSync(path.join(resolved, "metadata.json"))) fail(`Not an Eagle library: ${resolved}`);
  if (fs.existsSync(FILES.config) && !options.force) fail(`Configuration already exists: ${FILES.config}. Use --force to replace it.`);
  writeJson(FILES.config, {
    sources: [{ type: "eagle", path: resolved }],
    context: { maxItems: 6, maxProfileWords: 1200, maxProfileSections: 3 },
    storyboards: { frames: 6 },
  });
  for (const filePath of [FILES.catalog, FILES.analysis, FILES.feedback]) {
    if (!fs.existsSync(filePath)) writeJsonl(filePath, []);
  }
  if (!fs.existsSync(FILES.profile)) {
    atomicWrite(FILES.profile, "# Taste Profile\n\n_No confirmed principles yet._\n");
  }
  writeOutput({ status: "initialized", root: DATA_ROOT, library: resolved }, options.format);
}

function commandUpdate(options) {
  const config = loadConfig();
  const sources = config.sources.filter((source) => source.type === "eagle");
  if (sources.length === 0) fail("No Eagle source configured");
  const records = sources.flatMap((source) => scanEagle(path.resolve(source.path)));
  const unique = new Map(records.map((record) => [record.id, record]));
  const sorted = [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
  writeJsonl(FILES.catalog, sorted);
  writeOutput({
    status: "updated",
    items: sorted.length,
    byKind: countBy(sorted, (item) => item.kind),
    tagged: sorted.filter((item) => item.tags.length > 0).length,
    catalog: FILES.catalog,
  }, options.format);
}

function countBy(items, getKey) {
  const result = {};
  for (const item of items) {
    const key = getKey(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function indexById(records) {
  return new Map(records.map((record) => [record.id, record]));
}

function requireCatalog() {
  const catalog = readJsonl(FILES.catalog);
  if (catalog.length === 0) fail("The catalog is empty. Run `taste update` first.");
  return catalog;
}

function commandInspect(id, options) {
  if (!id) fail("inspect requires an item ID");
  const normalized = id.includes(":") ? id : `eagle:${id}`;
  const catalog = indexById(requireCatalog());
  const item = catalog.get(normalized);
  if (!item) fail(`Unknown item: ${normalized}`);
  const analysis = indexById(readJsonl(FILES.analysis)).get(normalized) || null;
  const feedback = indexById(readJsonl(FILES.feedback)).get(normalized) || null;
  writeOutput({ item, analysis, feedback }, options.format);
}

function commandStoryboard(target, options) {
  const catalog = requireCatalog();
  const frames = positiveInteger(options.frames, loadConfig().storyboards.frames);
  const selected = options.all
    ? catalog.filter((item) => item.kind === "video")
    : catalog.filter((item) => item.id === (target?.includes(":") ? target : `eagle:${target}`));
  if (selected.length === 0) fail(options.all ? "No videos found" : `Unknown video: ${target}`);
  const helper = path.join(CODE_ROOT, "bin", "video-storyboard.swift");
  if (!fs.existsSync(helper)) fail(`Missing storyboard helper: ${helper}`);
  fs.mkdirSync(FILES.storyboards, { recursive: true });
  const generated = [];
  for (const item of selected) {
    if (item.kind !== "video" || !item.assetPath) continue;
    const output = path.join(FILES.storyboards, `${item.sourceId}.jpg`);
    if (fs.existsSync(output) && !options.force) {
      generated.push({ id: item.id, path: output, status: "existing" });
      continue;
    }
    const result = spawnSync("xcrun", ["swift", helper, item.assetPath, output, String(frames)], { encoding: "utf8" });
    if (result.status !== 0) fail(`Storyboard failed for ${item.id}: ${result.stderr || result.stdout}`);
    generated.push({ id: item.id, path: output, status: "generated" });
  }
  const refreshed = catalog.map((item) => {
    const output = path.join(FILES.storyboards, `${item.sourceId}.jpg`);
    return { ...item, storyboardPath: fs.existsSync(output) ? output : item.storyboardPath };
  });
  writeJsonl(FILES.catalog, refreshed);
  writeOutput({ storyboards: generated }, options.format);
}

function validateStringArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    fail(`${label} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((entry) => entry.trim()))];
}

function commandAnalysisExport(options) {
  const catalog = requireCatalog();
  const existing = indexById(readJsonl(FILES.analysis));
  const limit = positiveInteger(options.limit, 20);
  const eligible = catalog.filter((item) => !options.new || !existing.has(item.id));
  const selected = eligible
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      assetPath: item.assetPath,
      previewPath: item.previewPath,
      storyboardPath: item.storyboardPath,
      sourceUrl: item.sourceUrl,
      metadata: {
        tags: item.tags,
        folders: item.folders,
        width: item.width,
        height: item.height,
        durationSeconds: item.durationSeconds,
        palette: item.palette,
      },
    }));
  writeOutput({
    schemaVersion: 1,
    type: "taste-analysis-batch",
    generatedAt: new Date().toISOString(),
    instruction: "Describe visible properties neutrally. Do not infer what the user likes.",
    observationFields: OBSERVATION_FIELDS,
    items: selected,
    omitted: Math.max(0, eligible.length - selected.length),
  }, options.format);
}

function commandAnalysisImport(filePath, options) {
  if (!filePath) fail("analysis import requires a JSON file");
  const payload = readJson(path.resolve(filePath));
  if (!Array.isArray(payload.items)) fail("Analysis result must contain an items array");
  const catalog = indexById(requireCatalog());
  const existing = indexById(readJsonl(FILES.analysis));
  for (const raw of payload.items) {
    if (!catalog.has(raw.id)) fail(`Analysis references unknown item: ${raw.id}`);
    const observations = {};
    for (const field of OBSERVATION_FIELDS) {
      observations[field] = validateStringArray(raw.observations?.[field], `${raw.id}.observations.${field}`);
    }
    existing.set(raw.id, {
      schemaVersion: 1,
      id: raw.id,
      summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
      observations,
      analyzedAt: new Date().toISOString(),
    });
  }
  writeJsonl(FILES.analysis, [...existing.values()].sort((a, b) => a.id.localeCompare(b.id)));
  writeOutput({ status: "imported", items: payload.items.length, analysis: FILES.analysis }, options.format);
}

function commandFeedbackImport(filePath, options) {
  if (!options.confirmed) fail("Feedback import requires --confirmed after explicit user approval");
  if (!filePath) fail("feedback import requires a JSON file");
  const payload = readJson(path.resolve(filePath));
  if (!Array.isArray(payload.items)) fail("Feedback result must contain an items array");
  const catalog = indexById(requireCatalog());
  const existing = indexById(readJsonl(FILES.feedback));
  for (const raw of payload.items) {
    if (!catalog.has(raw.id)) fail(`Feedback references unknown item: ${raw.id}`);
    if (!FEEDBACK_STATUSES.has(raw.status)) fail(`${raw.id}.status must be core, exploring, reference-only, or avoid`);
    existing.set(raw.id, {
      schemaVersion: 1,
      id: raw.id,
      status: raw.status,
      like: validateStringArray(raw.like, `${raw.id}.like`),
      avoid: validateStringArray(raw.avoid, `${raw.id}.avoid`),
      useFor: validateStringArray(raw.useFor, `${raw.id}.useFor`),
      reviewedAt: new Date().toISOString(),
    });
  }
  writeJsonl(FILES.feedback, [...existing.values()].sort((a, b) => a.id.localeCompare(b.id)));
  writeOutput({ status: "imported", items: payload.items.length, feedback: FILES.feedback }, options.format);
}

function commandProfileExport(options) {
  const catalog = indexById(requireCatalog());
  const analysis = indexById(readJsonl(FILES.analysis));
  const feedback = readJsonl(FILES.feedback);
  const limit = positiveInteger(options.limit, 200);
  const selected = feedback
    .sort((left, right) => String(right.reviewedAt || "").localeCompare(String(left.reviewedAt || "")))
    .slice(0, limit);
  const evidence = selected.map((signal) => ({
    item: catalog.get(signal.id),
    feedback: signal,
    analysis: analysis.get(signal.id) || null,
  }));
  writeOutput({
    schemaVersion: 1,
    type: "taste-profile-evidence",
    generatedAt: new Date().toISOString(),
    instruction: "Propose concise high-level principles supported by confirmed feedback. Cite eagle IDs. Preserve avoid and useFor constraints.",
    evidence,
    omitted: Math.max(0, feedback.length - evidence.length),
  }, options.format);
}

function commandProfileImport(filePath, options) {
  if (!options.confirmed) fail("Profile import requires --confirmed after explicit user approval");
  if (!filePath) fail("profile import requires a Markdown file");
  const markdown = fs.readFileSync(path.resolve(filePath), "utf8").trim();
  if (!markdown) fail("Profile cannot be empty");
  const known = indexById(requireCatalog());
  const references = [...markdown.matchAll(/\beagle:[A-Za-z0-9_-]+\b/g)].map((match) => match[0]);
  for (const reference of references) {
    if (!known.has(reference)) fail(`Profile cites unknown item: ${reference}`);
  }
  if (/^## /m.test(markdown) && references.length === 0) fail("Profile principles must cite at least one eagle:<id>");
  atomicWrite(FILES.profile, `${markdown}\n`);
  writeOutput({ status: "imported", profile: FILES.profile, evidenceIds: [...new Set(references)] }, options.format);
}

function tokenize(value) {
  return [...new Set(String(value).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1 && !STOP_WORDS.has(token)))];
}

function flattenObservations(analysis) {
  return analysis ? OBSERVATION_FIELDS.flatMap((field) => analysis.observations?.[field] || []) : [];
}

function scoreRecord(item, analysis, feedback, terms, query) {
  const lanes = [
    { weight: 6, values: feedback?.useFor || [] },
    { weight: 5, values: feedback?.like || [] },
    { weight: 3, values: flattenObservations(analysis) },
    { weight: 3, values: [analysis?.summary || ""] },
    { weight: 2, values: item.tags },
    { weight: 2, values: item.folders },
    { weight: 1, values: [item.name] },
  ];
  let score = feedback?.status === "core" ? 2 : feedback?.status === "exploring" ? 1 : 0;
  const matched = new Set();
  for (const lane of lanes) {
    const text = lane.values.join(" ").toLowerCase();
    for (const term of terms) {
      if (text.includes(term)) {
        score += lane.weight;
        matched.add(term);
      }
    }
    if (query.length > 3 && text.includes(query.toLowerCase())) score += lane.weight * 2;
  }
  return { score, matched: [...matched] };
}

function profileSections(markdown) {
  if (!markdown.trim()) return [];
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = { heading: "Overview", lines: [] };
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current.lines.some((entry) => entry.trim())) sections.push(current);
      current = { heading: line.slice(3).trim(), lines: [line] };
    } else if (!line.startsWith("# ")) {
      current.lines.push(line);
    }
  }
  if (current.lines.some((entry) => entry.trim())) sections.push(current);
  return sections.map((section) => ({ ...section, text: section.lines.join("\n").trim() }));
}

function boundedProfile(query, config) {
  if (!fs.existsSync(FILES.profile)) return { text: "", omittedSections: 0 };
  const terms = tokenize(query);
  const sections = profileSections(fs.readFileSync(FILES.profile, "utf8"));
  const ranked = sections.map((section, index) => ({
    ...section,
    index,
    score: terms.reduce((total, term) => total + (section.text.toLowerCase().includes(term) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = ranked.slice(0, config.maxProfileSections).sort((a, b) => a.index - b.index);
  const words = [];
  for (const section of selected) {
    for (const word of section.text.split(/\s+/)) {
      if (words.length >= config.maxProfileWords) break;
      words.push(word);
    }
    if (words.length >= config.maxProfileWords) break;
    words.push("\n\n");
  }
  return { text: words.join(" ").replace(/ \n\n /g, "\n\n").trim(), omittedSections: Math.max(0, sections.length - selected.length) };
}

function commandContext(query, options) {
  if (!query?.trim()) fail("context requires a task query");
  const config = loadConfig().context;
  const limit = Math.min(positiveInteger(options.limit, config.maxItems), config.maxItems);
  const catalog = requireCatalog();
  const analysis = indexById(readJsonl(FILES.analysis));
  const feedback = indexById(readJsonl(FILES.feedback));
  const terms = tokenize(query);
  const ranked = catalog
    .filter((item) => options["include-avoid"] || feedback.get(item.id)?.status !== "avoid")
    .map((item) => {
      const itemAnalysis = analysis.get(item.id) || null;
      const itemFeedback = feedback.get(item.id) || null;
      return { item, analysis: itemAnalysis, feedback: itemFeedback, ...scoreRecord(item, itemAnalysis, itemFeedback, terms, query) };
    })
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  const selected = ranked.filter((entry) => entry.score > 0).slice(0, limit);
  const fallback = selected.length ? selected : ranked.filter((entry) => entry.feedback?.status === "core" || entry.feedback?.status === "exploring").slice(0, limit);
  const profile = boundedProfile(query, config);
  const packet = {
    schemaVersion: 1,
    type: "taste-context",
    generatedAt: new Date().toISOString(),
    query,
    profileExcerpt: profile.text,
    profileSectionsOmitted: profile.omittedSections,
    references: fallback.map((entry) => ({
      id: entry.item.id,
      name: entry.item.name,
      kind: entry.item.kind,
      assetPath: entry.item.assetPath,
      previewPath: entry.item.previewPath,
      storyboardPath: entry.item.storyboardPath,
      sourceUrl: entry.item.sourceUrl,
      confirmed: entry.feedback,
      observations: entry.analysis,
      matchedTerms: entry.matched,
    })),
    omittedCandidates: Math.max(0, ranked.length - fallback.length),
    limits: { references: limit, profileWords: config.maxProfileWords, profileSections: config.maxProfileSections },
  };
  writeOutput(packet, options.format);
}

function seededRandom(seed) {
  if (!seed) return Math.random;
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6D2B79F5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function takeUnique(pool, count, selected, random) {
  const leastRecentlyShown = pool.slice(0, Math.max(count * 4, count));
  for (const item of shuffled(leastRecentlyShown, random)) {
    if (selected.length >= count) break;
    if (!selected.some((entry) => entry.id === item.id)) selected.push(item);
  }
}

function commandReview(options) {
  const count = positiveInteger(options.count, 6);
  const catalog = requireCatalog();
  const feedback = indexById(readJsonl(FILES.feedback));
  const state = readJson(FILES.reviewState, { schemaVersion: 1, items: {} });
  const random = seededRandom(options.seed);
  const byOldest = (left, right) => {
    const leftDate = state.items[left.id]?.lastShown || "";
    const rightDate = state.items[right.id]?.lastShown || "";
    return leftDate.localeCompare(rightDate);
  };
  const unreviewed = catalog.filter((item) => !feedback.has(item.id)).sort(byOldest);
  const uncertain = catalog.filter((item) => ["exploring", "reference-only"].includes(feedback.get(item.id)?.status)).sort(byOldest);
  const core = catalog.filter((item) => feedback.get(item.id)?.status === "core").sort(byOldest);
  const eligible = catalog.filter((item) => feedback.get(item.id)?.status !== "avoid").sort(byOldest);
  const selected = [];
  takeUnique(unreviewed, Math.min(2, count), selected, random);
  takeUnique(uncertain, Math.min(4, count), selected, random);
  takeUnique(core, Math.min(5, count), selected, random);
  takeUnique(eligible, count, selected, random);
  const finalSelection = selected.slice(0, count);
  if (!options["dry-run"]) {
    const now = new Date().toISOString();
    for (const item of finalSelection) {
      const prior = state.items[item.id] || { showCount: 0 };
      state.items[item.id] = { lastShown: now, showCount: prior.showCount + 1 };
    }
    writeJson(FILES.reviewState, state);
  }
  const packet = {
    schemaVersion: 1,
    type: "taste-review",
    generatedAt: new Date().toISOString(),
    prompts: [
      "Does this still belong in the taste bank?",
      "What exact quality do you like?",
      "What should an agent not copy?",
      "Where would this reference be useful?",
    ],
    items: finalSelection.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      assetPath: item.assetPath,
      previewPath: item.previewPath,
      storyboardPath: item.storyboardPath,
      currentFeedback: feedback.get(item.id) || null,
    })),
  };
  writeOutput(packet, options.format);
}

function writeOutput(value, format = "json") {
  if (format === "markdown" || format === "md") {
    process.stdout.write(`${toMarkdown(value)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

function toMarkdown(value) {
  if (value.type === "taste-review") {
    return [
      "# Taste Review",
      "",
      ...value.items.flatMap((item, index) => [
        `## ${index + 1}. ${item.name}`,
        "",
        `- ID: \`${item.id}\``,
        `- Kind: ${item.kind}`,
        `- Preview: \`${item.storyboardPath || item.previewPath || item.assetPath}\``,
        ...value.prompts.map((prompt) => `- ${prompt}`),
        "",
      ]),
    ].join("\n");
  }
  if (value.type === "taste-context") {
    return [
      "# Taste Context",
      "",
      `Task: ${value.query}`,
      "",
      value.profileExcerpt ? `## Profile\n\n${value.profileExcerpt}\n` : "",
      "## References",
      "",
      ...value.references.flatMap((item) => [
        `### ${item.name}`,
        "",
        `- ID: \`${item.id}\``,
        `- Media: \`${item.assetPath}\``,
        `- Preview: \`${item.storyboardPath || item.previewPath}\``,
        item.confirmed?.like?.length ? `- Like: ${item.confirmed.like.join("; ")}` : "",
        item.confirmed?.avoid?.length ? `- Avoid: ${item.confirmed.avoid.join("; ")}` : "",
        item.confirmed?.useFor?.length ? `- Use for: ${item.confirmed.useFor.join("; ")}` : "",
        "",
      ].filter(Boolean)),
    ].filter(Boolean).join("\n");
  }
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function help() {
  return `Tasteware CLI

Usage:
  taste init --library <Eagle.library>
  taste update
  taste inspect <eagle:id>
  taste storyboard <eagle:id> [--frames 6] [--force]
  taste storyboard --all [--frames 6] [--force]
  taste analysis export [--new] [--limit 20]
  taste analysis import <results.json>
  taste feedback import <feedback.json> --confirmed
  taste profile export
  taste profile import <profile.md> --confirmed
  taste review [--count 6] [--format markdown] [--dry-run]
  taste context <task query> [--limit 6] [--format markdown]
`;
}

function main() {
  const { positional, options } = parseArgv(process.argv.slice(2));
  const [command, subcommand, ...rest] = positional;
  if (!command || command === "help" || options.help) {
    process.stdout.write(help());
    return;
  }
  if (command === "init") return commandInit(options);
  if (command === "update") return commandUpdate(options);
  if (command === "inspect") return commandInspect(subcommand, options);
  if (command === "storyboard") return commandStoryboard(subcommand, options);
  if (command === "analysis" && subcommand === "export") return commandAnalysisExport(options);
  if (command === "analysis" && subcommand === "import") return commandAnalysisImport(rest[0], options);
  if (command === "feedback" && subcommand === "import") return commandFeedbackImport(rest[0], options);
  if (command === "profile" && subcommand === "export") return commandProfileExport(options);
  if (command === "profile" && subcommand === "import") return commandProfileImport(rest[0], options);
  if (command === "review") return commandReview(options);
  if (command === "context") return commandContext([subcommand, ...rest].filter(Boolean).join(" "), options);
  fail(`Unknown command.\n\n${help()}`);
}

main();
