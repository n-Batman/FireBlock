# Satellite identity, reuse and efficiency

Copernicus products have stable 36-character UUIDs. Keep the full UUID: shortening
it or matching only by location could confuse different passes or reprocessed
products. Each full product/preview is stored once under a canonical B2 name:

```text
satellite/<product-uuid>/product.zip
satellite/<product-uuid>/product.nc
satellite/<product-uuid>/quicklook.image
```

During a cloud scrape, catalogue selection still determines which products
intersect each box. Before downloading an asset, the raw-data controller checks
its local UUID index, then validates the referenced immutable B2 version using
object metadata. A hit skips both source download and duplicate cloud upload.
Each batch manifest references the shared file ID, byte count and SHA-1 while
preserving the original `copernicus/<uuid>/...` dataset layout on restore.
Fresh product/query metadata is still recorded for each batch. Acquisition-time
lookups in the parser follow the batch's `metadata_key` even for shared imagery.

The local `.cache/satellite-index.json` contains **metadata only**, not imagery,
API keys or bearer tokens. It is capped at 5,000 entries and 4 MiB. Keys include
the bucket and UUID asset identity; B2 file IDs remain intact for immutable reads.
An evicted/missing index entry is recovered with a narrowly scoped canonical-key
listing, never a whole-bucket scan. Deleted cloud versions invalidate the cached
reference. Authentication/network errors stop reuse rather than silently creating
another upload. `FIREBLOCK_INDEX_DIR` can place the metadata cache elsewhere.

A file lock serializes native archive operations using the same local index.
The desktop spiral already processes boxes sequentially. Separate machines with
independent indexes do not share a distributed lock; coordinate their writers if
collecting the same products simultaneously. B2 permits multiple versions of a
name, so a canonical name alone is not a cross-machine uniqueness constraint.

Manual `publish` also reuses canonical satellite assets when their hashes match;
a changed payload under the same UUID/asset is rejected. Older `raw/<batch>/`
objects remain valid and are not automatically deleted or retrospectively merged.
The new canonical index does not automatically discover legacy copies under old
batch names. Do not purge them while older manifests reference their file IDs.

Local-only spiral jobs reuse a single `shared/copernicus/` directory inside the
run. Completed asset receipts prevent repeated source downloads within that run;
per-box FIRMS outputs remain separate. For parsing those local-only results,
satellite files are under that shared directory rather than repeated in each box.
Independent local-only runs retain their own explicit local outputs.

FIRMS doesn't supply a Copernicus-style product UUID. Its query identity includes
sensor, area and date window, and near-real-time observations can be revised.
Those CSV snapshots intentionally refresh rather than trusting a permanent
location-only cache. The risk worker already deduplicates thermal detections by
location, acquisition time, satellite and instrument across source files. That
preserves revisits as distinct observations and avoids inflating hotspot pressure.

Catalogue JSON is saved once per result page instead of once per product, avoiding
quadratic metadata rewrites on large selections. Full imagery is streamed as
before. This optimization reduces duplicate I/O; it is not a claim of a measured
production throughput improvement.

Tests exercise canonical upload reuse, local-index recovery, source-download
avoidance and restoration of shared files. All old manifests remain supported;
new shared entries use `storage_kind: shared_satellite` with a canonical key that
must agree with the UUID and asset filename in the manifest path.
