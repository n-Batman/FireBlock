# Parcel detail by zoom

## Current loading behavior

Below zoom 17, individual county parcels are not requested, converted, scored or
drawn. The camera reports its initial zoom before the first request. Zoom changes
are part of the lookup key even if the geographic bounds are unchanged, and
zooming out aborts pending detail requests and immediately removes old details.
At zoom 17 or higher, one request loads the current viewport's parcel boundaries.
The original 25 km2 request limit, score cache and evidence rules still apply.

The overview is a set of larger approximate area tiles derived directly from the
already loaded satellite risk grid, with no extra parcel-service requests. Tiles
are 512 Web Mercator meters wide at zoom 16 (about 418 ground meters near SLO),
doubling per zoom level out. At most 256 shapes are drawn; wider views coarsen
further instead of dropping shapes or loading thousands of lots. Clicking an
area moves to zoom 17, where individual property ratings load.

Risk cells crossing tile edges are split with rectangle arithmetic. Scores use
the spherical area-weighted mean of known coverage and remain unknown unless
at least 60% of a tile has scored evidence. These are regional satellite estimates,
not parcel aggregates or invented house ratings. Unmapped areas stay empty.
There is no new fetch, persistent cache, raw scan storage or telemetry.

The previous display-only grouping below did not reduce network or scoring work
and could leave most lots individually drawn. It is superseded by this loading
gate and risk-grid overview. Its geometry helper remains for compatibility.

## Previous display-only grouping

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
