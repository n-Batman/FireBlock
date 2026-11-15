# Scanner eval

Images in manifest: 127. Dropped as irrelevant by GPT: 8. Scored: 119 (8 flagged as probable label errors and left out of the rates). Failed: 0.
Pass = dry% within 15 pts of GPT's estimate; dirt buckets also need risk under 3% of the frame; VegAnn needs risk on under 5% of background pixels.

| Bucket | n | Pass | Mean abs err (pts) |
|---|---|---|---|
| Chaparral | 3 | 67% | 14.7 |
| Cover crops | 20 | 85% | 10.5 |
| Dry grass | 22 | 64% | 12.0 |
| Grasslands of California | 23 | 74% | 9.7 |
| Lawns | 21 | 71% | 13.4 |
| Vineyards in California | 18 | 56% | 26.9 |
| own | 4 | 25% | 20.4 |
| **all** | 111 | 68% | |

- Dirt false positives (bare-soil + dirt-road buckets, risk over 3% of frame): 0/0
- VegAnn background false positives: mean 0.0% of background pixels read as risk; 0/0 images over 5%
- "All clear" while risk is drawn (must be 0): **0**

## Worst 20

| Image | Bucket | Ours | Expected | Why |
|---|---|---|---|---|
| [vineyards-in-california-16895865](https://commons.wikimedia.org/wiki/File:BOB_MARTINEZ_SPRAYING_GRAPE_VINES_-_NARA_-_542533.jpg) | Vineyards in California | 100% | 10% | dry% off by 90 |
| [vineyards-in-california-2553160](https://commons.wikimedia.org/wiki/File:Dorn_bay_clear_lake_state_park_ca.jpg) | Vineyards in California | 92% | 15% | dry% off by 77 |
| [cover-crops-48210681](https://commons.wikimedia.org/wiki/File:Cover_crops_in_Northwestern_South_Dakota_2015_(20115558362).jpg) | Cover crops | 12% | 80% | dry% off by 68 |
| [vineyards-in-california-132907263](https://commons.wikimedia.org/wiki/File:Bechthold_Vineyard_-_Cinsaut_-_planted_1886.jpg) | Vineyards in California | 70% | 10% | dry% off by 60 |
| [vineyards-in-california-3752472](https://commons.wikimedia.org/wiki/File:CaliforniaVineyard.jpg) | Vineyards in California | 62% | 5% | dry% off by 57 |
| [cover-crops-80580071](https://commons.wikimedia.org/wiki/File:Kremsm%C3%BCnster_Guntendorf-3849.jpg) | Cover crops | 0% | 55% | dry% off by 55 |
| [lawns-10810140](https://commons.wikimedia.org/wiki/File:Blissfield_township_betz_airport.JPG) | Lawns | 86% | 35% | dry% off by 51 |
| [vineyards-in-california-1190684](https://commons.wikimedia.org/wiki/File:California-grapesjpg.jpg) | Vineyards in California | 59% | 10% | dry% off by 49 |
| [vineyards-in-california-61303863](https://commons.wikimedia.org/wiki/File:Bronco_Winery_Modesto_California.JPG) | Vineyards in California | 0% | 45% | dry% off by 45 |
| [lawns-24908552](https://commons.wikimedia.org/wiki/File:Beautiful_nice_grass.jpg) | Lawns | 45% | 2% | dry% off by 43 |
| [lawns-63333436](https://commons.wikimedia.org/wiki/File:Acceso_Camping.jpg) | Lawns | 51% | 10% | dry% off by 41 |
| [lawns-17908180](https://commons.wikimedia.org/wiki/File:Baltimore_and_Ohio_Railroad_Company_Depot_site.jpg) | Lawns | 100% | 60% | dry% off by 40 |
| [grasslands-of-california-55064873](https://commons.wikimedia.org/wiki/File:August_2012_-_panoramio_(48).jpg) | Grasslands of California | 62% | 25% | dry% off by 37 |
| [lawns-8046355](https://commons.wikimedia.org/wiki/File:Bersarinplatz_14.JPG) | Lawns | 41% | 5% | dry% off by 36 |
| [vineyards-in-california-132907264](https://commons.wikimedia.org/wiki/File:Brovelli_Ranch_-_Zinfandel_-_planted_1954.jpg) | Vineyards in California | 53% | 20% | dry% off by 33 |
| [dry-grass-25124001](https://commons.wikimedia.org/wiki/File:Agropyron_dasystachyum_and_bull_snake_(4010792912).jpg) | Dry grass | 40% | 70% | dry% off by 30 |
| [dry-grass-27443632](https://commons.wikimedia.org/wiki/File:Abra.jpg) | Dry grass | 75% | 45% | dry% off by 30 |
| [dry-grass-29207309](https://commons.wikimedia.org/wiki/File:Blowing_in_the_breeze_(5822375129)_(2).jpg) | Dry grass | 93% | 65% | dry% off by 28 |
| [own-srv1](local:test-photos) | own | 4% | 30% | dry% off by 26 |
| [own-srv9](local:test-photos) | own | 51% | 25% | dry% off by 26 |

## Probable label errors (GPT estimate looks wrong; not tuned to)

| Image | Bucket | Ours | GPT | Reason |
|---|---|---|---|---|
| [dry-grass-49093863](https://commons.wikimedia.org/wiki/File:Boukornine_8.jpg) | Dry grass | 100% | 55% | note says bare ground |
| [dry-grass-57336474](https://commons.wikimedia.org/wiki/File:Autumn_on_the_New_River_Trail_(32684965271).jpg) | Dry grass | 96% | 45% | note says bare ground |
| [grasslands-of-california-30868722](https://commons.wikimedia.org/wiki/File:Distant_view_of_snow-capped_Mount_San_Antonio_(or_Mount_Baldy),_ca.1920_(CHS-5558).jpg) | Grasslands of California | 0% | 50% | snow or monochrome scene, no rateable vegetation |
| [vineyards-in-california-132914886](https://commons.wikimedia.org/wiki/File:Bishofberger_Vineyard_-Carignan_-_planted_1936.jpg) | Vineyards in California | 100% | 55% | note says bare ground |
| [vineyards-in-california-153752124](https://commons.wikimedia.org/wiki/File:California_Vineyard,_1933.jpg) | Vineyards in California | 100% | 25% | note says snow/monochrome |
| [vineyards-in-california-30872782](https://commons.wikimedia.org/wiki/File:Chinese_farm_workers_pruning_a_vineyard,_ca.1900_(CHS-1372).jpg) | Vineyards in California | 0% | 80% | snow or monochrome scene, no rateable vegetation |
| [vineyards-in-california-71307643](https://commons.wikimedia.org/wiki/File:500px_photo_(27949905).jpeg) | Vineyards in California | 0% | 75% | snow or monochrome scene, no rateable vegetation |
| [vineyards-in-california-73797141](https://commons.wikimedia.org/wiki/File:A_California_vineyard_covered_in_snow.jpg) | Vineyards in California | 0% | 70% | snow or monochrome scene, no rateable vegetation |
