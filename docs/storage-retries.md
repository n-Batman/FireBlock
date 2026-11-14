# Storage retries and collection errors

Backblaze HTTP 500–599 responses on authorization, metadata reads and uploads
receive at most **four total attempts** (the initial request plus three retries).
The waits are **1, 2 and 4 seconds**, independently bounded for each request.
Retry status appears in the CLI and the scraper's redacted `progress.log`.

An upload adds a random `fireblock_upload_id` file-info value that is reused
across its attempts. After a 5xx response, the controller looks for that receipt
among versions of the exact object name and verifies its SHA-1 and byte count.
A matching version is returned as success without another upload. An unrelated
older version with identical bytes is not considered the current upload.
If no matching receipt is found, the controller requests a new upload URL and
token before retrying. The source file must still match its original checksum
and byte count. Fresh upload URLs follow the
[Backblaze integration guidance](https://www.backblaze.com/docs/cloud-storage-integration-checklist).

Receipt lookup requires `listFiles`. It examines at most 1,000 versions from the
exact-name prefix. Permission failures, lookup errors, or a continuation with
more versions of the exact name stop the upload instead of triggering a blind
replay. Read requests used by verification have their own four-attempt limit.
Receipt checks reduce duplicates after ambiguous responses; they do not provide
transactional, exactly-once upload semantics if an earlier request is still
being committed when a lookup runs. There is no automatic remote deletion.

Exhaustion reports, for example:

```text
Backblaze upload failed with HTTP 500 after 4 attempts. Collection stopped; completed boxes are preserved. Check progress.log.
```

The desktop controller stops before starting the next box, emits an error event
for the **Scraper stopped** dialog, records the message on the failed collection
tile, and writes `error.json` in the run folder. The receipt contains the box,
exit code and redacted message. Credentials and raw provider response bodies
are not included. Headless controllers can consume the error event, terminal
state, or `error.json`; these changes do not configure email or chat delivery.

HTTP 4xx permission/input errors and transport exceptions are not newly retried.
The existing one-time expired-account-token refresh remains. Bucket mutations,
hide markers and deletions are not automatically replayed. Provider ingestion
has its existing separate retry behavior. This change retries individual B2
operations; it does not automatically restart previously failed collection runs.

Verification covers injected 500/503 recovery, fresh upload URLs and backoff,
receipt recovery (including on the final attempt), unrelated older versions,
bounded permanent failure, unavailable verification, changed sources, and
non-replayed mutations. Controller integration tests verify failed manifests and
absence of a completed publication after exhaustion. Python tests verify the
durable redacted error event and that later boxes do not start.
