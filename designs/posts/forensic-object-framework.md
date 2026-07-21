---
title: Forensic Object Framework
status: Draft
date: 2026-07-20
updated: 2026-07-20
author: James Habben
scope: [iLEAPP, ALEAPP, RLEAPP, VLEAPP, LAVA]
discussion: https://github.com/abrignoni/iLEAPP/issues/1736
excerpt: Proposal for a normalized, cross-artifact forensic object layer that preserves source artifact output while enabling combined LAVA views and future analyzers.
---

## Summary

This proposal creates a second output model for LEAPPs:

1. **Artifacts** preserve parser-specific, source-specific records.
2. **Forensic objects** normalize common investigative concepts across apps and platforms.
3. **Analyzers** interpret and enrich normalized objects.
4. **LAVA views** combine, correlate, and present those objects.

Existing artifact output remains authoritative. The new object layer is additive: parsers may continue producing normal artifact rows while also checking in typed objects such as web visits, searches, credentials, bookmarks, and downloads.

## Problem

Many parsers produce records that represent the same investigative concept:

- Web visits from Safari, Chrome, Firefox, WebViews, or app-internal browsers
- Searches from browsers, Spotlight, device search, app search, messages, files, or maps
- Credentials from browsers, password managers, app databases, or platform stores
- Bookmarks, downloads, cached content, accounts, file references, and similar records

Today those records stay inside source-specific artifact tables. That preserves evidence detail, but it makes cross-app review, LAVA grouping, and later enrichment harder than necessary.

The key: multiple artifact parsers can contribute records representing the same conceptual kind of evidence.

## Proposal

Add a **Forensic Object Framework** with an **Object Manager** that accepts typed object check-ins from parsers.

```text
Source files
  -> App/platform artifact parser
  -> Normal LEAPP artifact output
     + Forensic object check-in
  -> Report-level object store
  -> LAVA object views
  -> Optional analyzers and enrichment
```

The implementation name can be practical and short, such as `object_manager`, while the public design language can use **Forensic Object Framework**.

## Design Boundaries

### Artifacts remain authoritative

The current LEAPP artifact output should remain the primary source-specific parser result. A Safari history artifact, for example, should still produce its normal artifact rows. It may also check in `WebVisit` objects for cross-artifact views.

### Objects are typed

Prefer typed models over generic dictionaries:

```python
check_in_object(
    WebVisit(
        url=url,
        visited_at=timestamp,
        title=title,
        source_app="Chrome",
        source_artifact="Chrome History",
    )
)
```

Typed models give LEAPP:

- Validation
- Predictable schemas
- Schema versioning
- Better tests
- Safer LAVA rendering
- Better documentation for module authors

An overly generic `check_in_object(type, properties)` API would likely recreate the inconsistent artifact-output problem inside a second framework.

### Public API style

One review question is whether the public parser API should match Media Manager's multiple-import style or use a single namespace/manager import.

Media Manager-style imports would be explicit:

```python
from scripts.object_manager import (
    check_in_object,
    WebVisit,
    WebCacheEntry,
)

object_ref = check_in_object(
    WebVisit(
        url=url,
        visited_at=timestamp,
        title=title,
    )
)
```

Namespace or manager-style imports would keep module imports shorter:

```python
import scripts.object_manager as objects

object_ref = objects.check_in_object(
    objects.WebVisit(...),
)
```

or, if the implementation exposes a manager instance:

```python
from scripts.object_manager import object_mgr

object_ref = object_mgr.check_in(
    object_mgr.WebVisit(...),
)
```

The Media Manager-style option is more consistent with existing LEAPP patterns and makes each module's dependencies explicit. The namespace or manager-style option gives module authors one import and makes object types discoverable from one place. This should be decided with contributor feedback before settling the API examples.

The examples above intentionally do not pass a separate source object. LEAPP already has a context class that knows which module and artifact are currently running. The object manager should either read that active context itself, matching the Media Manager pattern, or accept context from the caller only if explicit context passing proves necessary.

### Check-in returns a reference

The object manager should follow the Media Manager pattern: a parser checks in an object, and the object manager creates or updates the primary object entry plus a source reference entry. The manager should attach the current module/artifact context to that reference. The returned reference gives the parser something concrete to place back into the artifact row.

```python
object_ref = check_in_object(
    WebVisit(
        url=url,
        visited_at=timestamp,
        title=title,
    )
)
```

The artifact row can then include a dedicated object-reference column:

```python
data.append((
    timestamp,
    url,
    title,
    object_ref,
))
```

LAVA can recognize that column type and render it as an app deep link to the normalized object view. The reference table becomes the bridge between the source artifact row and the normalized object.

The reference cannot be fully finalized at check-in time. iLEAPP modules build and return a complete `data_list`; the framework creates the LAVA table and inserts rows only after the module returns. Therefore the object manager can create a pending reference during check-in, but it needs a second pass after artifact data is returned to bind each returned `object_ref` to its final artifact table and row number.

That finalization pass should happen in the artifact-processing layer, not inside each parser. The parser should not be responsible for tracking output row numbers. The framework can enumerate the returned `data_list`, find object-reference columns, and update the corresponding reference records with the LAVA table name, row number, and column name before or immediately after inserting the rows.

### References carry provenance

Every checked-in object needs enough information to get back to the original evidence. Some of that belongs on the primary object. Source-specific details should live on the reference entry, because one normalized object may be checked in by multiple parsers or multiple rows.

Rough sketch:

- `object_id`
- `object_ref_id`
- `object_type`
- `checkin_status` #default to 'pending'
- `source_platform`
- `source_app`
- `source_artifact`
- `source_module`
- `source_file`
- `source_record_identifier`
- `artifact_table_name`
- `artifact_row_number`
- `artifact_column_name`
- `source_data_reference`
- `parser_version`
- `object_schema_version`

LAVA should let an examiner move from a normalized object back to the source artifact row and source data. It should also let an examiner move from the original artifact row to the normalized object through the object-reference column.

The module and artifact values should come from the current LEAPP context when possible. The parser should only provide record-specific values that the context cannot know, such as a source file path, database primary key, or other source-record identifier, and only when those values are available.

### Deduplication is non-destructive

The first object store should keep each source observation. A Safari record, KnowledgeC record, and app WebView record may look like one event, but they may also be separate observations, synced records, rounded timestamps, or related but distinct activity.

LAVA can later provide:

- Grouped records
- Probable duplicates
- Correlated activity
- Canonicalized URLs
- Unique-value summaries

A future correlation layer can produce a `CorrelationGroup` without deleting source observations.

### Normalization is separate from interpretation

Normalization converts platform-specific records into standard objects:

```text
Safari history -> WebVisit
Chrome history -> WebVisit
Firefox places -> WebVisit
Spotlight query -> SearchEvent
Chrome search term -> SearchEvent
```

Interpretation consumes objects and creates higher-level findings:

```text
WebVisit -> Coinbase transaction evidence
CacheEntry -> decoded web object
SearchEvent -> possible intent category
URL -> gambling category
Credential -> reused domain/account relationship
```

This boundary lets SkinnyLegs-style logic operate against normalized objects without bypassing LEAPP parser contracts.

## Initial Object Types

The first version should stay narrow and durable.

### WebVisit

Represents an individual visit event when the source supports it.

Candidate fields:

- URL
- Normalized URL
- Title
- Visit timestamp
- Last visited timestamp
- Visit count
- Referrer URL
- Transition or visit type
- Browser or application
- Profile
- Private/incognito indicator
- Object reference

Individual visits should be preferred over URL aggregates. Aggregates can be derived later; individual visits cannot be recovered from an aggregate-only record.

### SearchEvent

Represents a search action or stored search term.

Candidate fields:

- Search term
- Timestamp
- Application
- Search provider
- Search target
- Originating URL
- Resulting URL
- Local versus remote
- Object reference

Possible `search_target` values:

- Web
- Device
- Files
- Messages
- Contacts
- App content
- Map/location
- Unknown

### Credential

Represents stored or observed credential material.

Candidate fields:

- Service or domain
- Username or account identifier
- Password or secret value
- Created timestamp
- Modified timestamp
- Last-used timestamp
- Application
- Credential type
- Protection/decryption status
- Object reference

The model should allow a secret to be absent, encrypted, masked, or merely indicated as existing.

### Bookmark

Represents a saved URL or target.

Candidate fields:

- URL or target
- Title
- Created timestamp
- Modified timestamp
- Folder or collection
- Application
- Object reference

Bookmarks should not be folded into history. A bookmark and a visit can point to the same URL, but they assert different things.

### Download

Represents a download or app-created downloaded file record.

Candidate fields:

- Source URL
- Destination path
- Filename
- Started timestamp
- Completed timestamp
- Byte size
- MIME/content type
- Application
- Status
- Object reference

### Web Storage and Cache

Local storage, session storage, IndexedDB, and cache entries may be too structurally different to force into one top-level user-facing object. They may work better as later analyzer-oriented objects:

- `WebStorageEntry`
- `CacheEntry`
- `IndexedDbRecord`

Large payloads should be referenced, not embedded directly into every object.

## Storage and LAVA

The object store should be project-level, not module-level, because the value comes from combining records across modules and tools.

A likely structure:

```text
forensic_objects
  id
  type
  schema_version
  created_at

web_visits
  object_id
  url
  visited_at
  ...

search_events
  object_id
  term
  searched_at
  ...

credentials
  object_id
  service
  username
  ...

object_references
  id
  object_id
  module
  artifact
  source_app
  source_file
  source_record_identifier
  artifact_table_name
  artifact_row_number
  artifact_column_name
  source_data_reference
  parser_version
```

A generic base table plus typed extension tables keeps normalized object fields queryable. The object-reference table preserves source-specific provenance and gives LAVA a stable target for deep links from artifact rows.

Artifact output should support a dedicated object-reference column type. That column would store the returned `object_ref_id`, and LAVA would render it as a link from the artifact row to the normalized object. This avoids fragile post-hoc searching through artifact tables to rediscover which row created or observed an object.

## Media Manager Relationship

Media Manager should remain separate. Media generally involves file-oriented work:

- Physical or virtual file extraction
- Thumbnails
- Hashes
- MIME/type detection
- Dimensions and duration
- EXIF metadata
- Exported files
- Path resolution
- Duplicate content
- Preview generation
- Large binary data

Generic forensic objects may reference Media Manager assets by stable identifier, while Media Manager remains responsible for binary files, previews, hashes, and media-specific metadata.

## Rollout Path

### Phase 1: Browser proof of concept

Implement:

- `WebVisit`
- `SearchEvent`
- `Bookmark`
- `Download`

Convert one browser parser from each major engine:

- Chromium
- WebKit
- Firefox

Normal artifact output remains unchanged.

### Phase 2: Non-browser proof

Have non-browser artifacts check in objects:

- Spotlight search as `SearchEvent`
- App-specific search history as `SearchEvent`
- Possibly an app-internal downloaded file as `Download`

This proves the framework is cross-app, not browser-specific.

### Phase 3: Analyzer API

Allow SkinnyLegs-style analyzer logic to consume normalized objects such as:

- `WebVisit`
- `CacheEntry`
- `WebStorageEntry`
- `IndexedDbRecord`

Analyzer output should not bypass LEAPP parser contracts.

### Phase 4: Correlation and enrichment

Add:

- URL categorization
- Domain extraction
- Probable duplicates
- Related searches and visits
- Account/domain relationships

## Review Questions

Feedback is most useful if it focuses on the boundaries and first implementation slice.

1. Is **Forensic Object Framework** the right public name, with `object_manager` as the implementation name?
2. Should the parser API match Media Manager's multiple declaration imports, or use a single namespace/manager import?
3. Are `WebVisit`, `SearchEvent`, `Bookmark`, and `Download` the right first object types?
4. What metadata belongs on the primary object, and what belongs on each source reference?
5. What should the dedicated object-reference artifact column be called, and how should LAVA render it?
6. Which existing parsers are the best candidates for the browser and non-browser proof points?
7. Any other thoughts or comments to consider?
