# Private grant application drafts and evidence PDFs

`POST /api/grant-reports` writes a CAL FIRE Fire Prevention Grants application
draft and treatment evidence PDF, then archives it in B2. `GET` downloads the
verified PDF by report ID. These are backend endpoints; there is no browser form
or scanner integration in this change. Both require `Authorization: Bearer
<CLOUD_WRITE_TOKEN>`, including downloads. Never put this token or OpenAI/B2 keys
in `NEXT_PUBLIC_` variables or browser code.

Set `OPENAI_API_KEY`, `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`,
`B2_BUCKET_NAME`, and `CLOUD_WRITE_TOKEN` on the server. Optional
`OPENAI_GRANT_MODEL` overrides the existing findings model. The B2 key needs
read, list (including bucket metadata) and write access. The configured bucket
must be `allPrivate`; the report service checks this before processing a project
and refuses to put report evidence in a public bucket. Deployments need to allow the route's 300-second
execution budget; hosting platforms may enforce a lower limit. Large projects
should be split into smaller reports. Missing OpenAI configuration returns 503;
AI failures never produce a completed application or a template substituted for
the requested AI narrative.

The API returns a draft and evidence attachment, **not** a submitted application,
eligibility decision, guarantee of funding, or claim that completed work will be
reimbursed. The applicant must review the current solicitation and fill out the
official forms/portal. CAL FIRE currently calls this program **Wildfire Prevention
Grants** and describes its grants portal on these official pages:

- https://www.fire.ca.gov/what-we-do/grants/wildfire-prevention-grants
- https://www.fire.ca.gov/what-we-do/grants

The `program` field is required, typed by the caller, and printed verbatim. For
this use case enter `CAL FIRE Fire Prevention Grants Program`. The PDF includes
project/property name, county, APNs, program, report date, preparer, a treatment
summary, AI narrative, treatment table, parcel risk map, paired proof photos and
metadata, missing evidence, and the exact requested method note. It does not
embed or depend on a changing official application form.

## Request

```json
{
  "project_name": "Property or project name",
  "county": "San Luis Obispo",
  "program": "CAL FIRE Fire Prevention Grants Program",
  "report_date": "2026-11-15",
  "prepared_by": "Preparer name and organization",
  "applicant_name": "Applicant organization",
  "project_description": "Describe the actual project and evidence supplied.",
  "community_benefit": "Describe the actual community benefit.",
  "implementation_plan": "Describe actual work and any proposed future work separately.",
  "requested_funding": 25000,
  "blocks": [{
    "block_id": "South block",
    "apn": "REPLACE_WITH_COUNTY_APN",
    "location": {"lat": 35.269972, "lon": -120.655722},
    "acres": 2.5,
    "treatment_type": "mowing",
    "date_treated": "2026-11-14",
    "before_scan": {"scan_id": "COPY_STORED_BASELINE_SCAN_ID", "photo": "data:image/jpeg;base64,..."},
    "after_scan": {"scan_id": "COPY_STORED_FOLLOWUP_SCAN_ID", "photo": "data:image/jpeg;base64,..."}
  }]
}
```

The example is illustrative, not an actual application. Replace APN and scan ID
placeholders. Save observations first using `/api/parcel-scans`; see
`parcel-scan-archive.md`. The caller can omit either scan or either photo.
Missing evidence prints `Not available`, `Not scanned`, or `Photo not supplied`.
A photo requires its stored scan ID. Existing scan records have no images, so
photos are attached by the preparer when requesting the report. Remote photo
URLs and arbitrary B2 IDs are not accepted. Photo EXIF/capture time is not
independently verified; the PDF says its dates, times and GPS come from the
associated stored scan, and labels this distinction.

There are 1-20 uniquely named blocks. Treatment types are exactly `mowing`,
`grazing`, `brush removal`, `other`. Treated acres must be positive. Summed block
acres per APN cannot exceed the county polygon area by more than 1% (GIS area
tolerance). Multiple blocks can share an APN, but the preparer must partition
treated ground so the same acres are not counted twice. Acres and treatment
dates are declarations, not inferred or verified by a photograph.

Each block's GPS point must match its APN in a fresh county lookup. Outlines
come from that lookup, never user-supplied polygons. Holes and multipart
outlines are preserved in the vector PDF map. The PDF intentionally contains
the requested parcel outlines and GPS evidence and stays outside the public
risk catalog. Confirm your organization's rights to include parcel data in
reports it distributes.

Scan timestamps must bracket the declared treatment date and not exceed the
report date. A stored scan cannot be reused for another block or phase.
Both scans in a pair must be the same-method original baseline/follow-up pair
accepted by the scan archive (including its 25 m location check). APN, provider
and GPS must match the report parcel. All scan times are printed in UTC.

## Scores and percentages

The table's risk scores are computed from checksum-verified cloud risk grids,
area weighted over the county parcel with the existing 60% coverage threshold.
Each block in the same APN receives that parcel's risk; no block-level polygon
score is implied. Current risk colors the map. No risk or dry percentage supplied
in a report request can override the stored measurements.

For risk before treatment, optionally pass a historical publication pin:

```json
"before_publication": {
  "manifest_file_id": "B2_IMMUTABLE_MANIFEST_ID",
  "manifest_sha256": "ACTUAL_64_CHARACTER_SHA256",
  "manifest_bytes": 12345
}
```

The server verifies this manifest and grid; contributing baseline model dates
cannot follow the treatment date. Without a baseline pin, risk before is
unavailable. After risk requires every contributing model run to be dated
on/after treatment and no later than the report date; otherwise it is unavailable.
Current risk remains visible on the map. Issue dates do not guarantee that
satellite imagery was collected after treatment; imagery and model provenance
are retained in the evidence JSON. A score change never proves treatment caused
it. Baseline and current model versions may differ and are recorded explicitly.

`cleared` means the after scan recorded zero dry vegetation in its sampled view;
`still dry` means it recorded a positive dry percentage; `not scanned` means no
after scan was supplied. No threshold is silently chosen and no label certifies
the entire parcel. The proof section's `Dry ground cover` percentage is the dry
share of visible ground vegetation, matching the archive's `dry-fuel-percent-v1`
metric. It is **not** percent of the whole image or parcel. Vines/tree canopy are
excluded by the existing phone scanner method; legacy records retain their
specific `model_id`. Risk scores and scan percentages remain separate measures.

OpenAI receives the preparer-supplied narrative fields, acreage summaries, block
IDs, dates and measured scores/status. It receives no photos, exact GPS, APNs or
raw cloud scan IDs. Requests use the Responses API, strict structured output,
`store:false`, a 45-second timeout and bounded output. Program/property and
preparer text is untrusted data. Prose is visibly an AI-assisted draft requiring
review; numbers in the register/summary/map are drawn directly from validated
data, not extracted from generated prose. Original text is retained in evidence
JSON; PDF standard-font rendering transliterates accented Latin characters and
replaces unsupported characters with `?`.

## Storage and retrieval

Success returns 201 with `report_id`, PDF and manifest checksum receipts, summary,
and `/api/grant-reports?report_id=<UUID>`. Send the bearer header to that URL to
download. It is not an anonymous public link.

```text
grant-reports/v1/<UUID>/photos/<block-index>-<before|after>.<jpg|png>
grant-reports/v1/<UUID>/evidence.json
grant-reports/v1/<UUID>/application.pdf
grant-reports/v1/<UUID>/manifest.json
```

The adapter verifies B2 upload SHA-1/length and records SHA-256. The completion
manifest is written last, after all photos, evidence and the PDF succeed.
Downloads find that exact completed manifest, follow its immutable PDF file ID,
and verify the PDF length, hash and signature before returning bytes. Failed
attempts may leave private orphan objects, but never a completed report link.
Retries create new reports; this API has no idempotency token or rollback.
PDFs do not enter `risk/catalog/` and do not change parcel scores.

Limits: 12 MiB total JSON request, 1 MiB and 8 million pixels per photo, JPEG/PNG
only, 20 MiB final PDF. JPEG/PNG decoding must succeed. There is no remote image
fetching. B2 objects use existing bounded checksum-verified reads. Both report
operations require the backend bearer token and return `private, no-store`.

## Verify and preview

```powershell
npm test -- src/lib/grantReports.test.ts src/lib/grantReportRoute.test.ts src/lib/cloudStorage.test.ts src/lib/parcelScanArchive.test.ts
npx tsc --noEmit
npm run build
npx tsx scripts/preview_grant_report.ts
```

The preview writes an explicitly synthetic example under
`analysis/grant-report-qa/output/pdf/`. It demonstrates all treatment types,
known/unknown risk, all scan statuses, paired illustrative images, missing
photos/scans and a polygon hole. It never creates a real applicant record. Add
`--env-file=.env` to `tsx`, `--live-ai` to call the configured OpenAI model, and
`--upload-qa` to verify a private B2 upload/download in a separate
`grant-reports/qa/<UUID>/` namespace. QA receipts are marked
`synthetic-preview-only`, outside the completed-report endpoint.
