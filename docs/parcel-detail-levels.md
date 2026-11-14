# Parcel detail by zoom

Dense small parcels are summarized below zoom 17. Three or more eligible parcels
in one stable map cell produce an approximate area tile instead of individual
outlines and rating pills. Cells are 192 Web Mercator meters at zoom 16 and double
in width with each zoom level out, up to zoom 12. Near SLO, the zoom-16 cell is
about 157 ground meters wide. These are display tiles, not surveyed city blocks.

Only parcels up to two acres whose exterior geometry fits inside a cell are
grouped. Sparse parcels, farms, long parcels crossing cell boundaries, and the
selected property retain their real geometry. A selected property draws above
the summary tile. At zoom 17 and above all original geometry and individual
ratings return. Clicking a tile moves to its center at zoom 17.

Tiles summarize the loaded parcels only, which may be a partial response. Their
tooltip reports total and scored counts. The color uses the area-weighted mean
of known parcel scores only when at least 60% of the loaded parcel area has a
score. Otherwise it is neutral. Unknown ratings never become zero. Tile colors
are aggregate estimates, not new property ratings, and do not imply that roads,
unloaded parcels, or the entire rectangular tile have been assessed.

The map's original parcel list, sidebar, risk calculations, exports, and cached
boundaries stay unchanged. The extra boundary overlay is suppressed when the
main parcel layer already supplies shapes, preventing duplicate individual
outlines from showing through the summaries.

Grouping runs in a memo scoped to the mounted map and current parcel array,
integer zoom and selected ID. There is no new persistent or global cache, fetch,
timer, location history, raw scan storage, or telemetry. React Leaflet manages
the zoom listener's lifetime. Updated scan scores rebuild the summaries.

Validation is limited to the grouping logic, existing cache regression tests,
changed-file type checks and whitespace checks; no frontend build or full UI
checks were run.
