# Portable contracts

Visor separates four kinds of data:

1. **Catalog** — deterministic facts read from a media source.
2. **Analysis** — neutral, replaceable observations produced by any multimodal agent.
3. **Feedback** — user-confirmed preference signals.
4. **Profile** — user-approved high-level principles citing item evidence.

The CLI owns validation and storage. It never invokes a particular model API.

## Analysis result

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "folder:library:ITEM_ID",
      "summary": "A short neutral description.",
      "observations": {
        "composition": ["one dominant focal point"],
        "typography": ["large grotesk display type"],
        "color": ["neutral field with one saturated accent"],
        "motion": ["staggered card entrance"],
        "interaction": ["progressive disclosure"],
        "mood": ["quiet", "precise"],
        "material": [],
        "imagery": []
      }
    }
  ]
}
```

Observations describe what is visibly present. They must not say that the user likes something.

## Confirmed feedback

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "folder:library:ITEM_ID",
      "status": "core",
      "like": ["spatially meaningful card choreography"],
      "avoid": ["device mockup presentation"],
      "useFor": ["mobile onboarding", "progressive disclosure"]
    }
  ]
}
```

Allowed statuses are `core`, `exploring`, `reference-only`, and `avoid`. Import requires `--confirmed`; the flag means the user approved the content, not merely that an agent generated it.

## Taste profile

The profile is Markdown. Confirmed principles use `##` sections and cite supporting item IDs. Import requires `--confirmed`. Visor verifies that cited IDs exist in the catalog.

## Context packet

`visor context` returns:

- the task query;
- a bounded excerpt from the confirmed profile;
- at most the configured number of references;
- paths to originals, previews, and video storyboards;
- confirmed `like`, `avoid`, and `useFor` signals;
- neutral observations;
- matched terms and omissions.

An external agent may use this packet inside its own workspace. The packet grants no permission to modify Visor, an external source library, a knowledge system, or a project.
