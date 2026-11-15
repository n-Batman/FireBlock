# Scanner eval

Images in manifest: 127. Dropped as irrelevant by GPT: 8. Scored: 119 (8 flagged as probable label errors and left out of the rates). Failed: 0.
Pass = dry% within 15 pts of GPT's estimate; dirt buckets also need risk under 3% of the frame; VegAnn needs risk on under 5% of background pixels.

| Bucket | n | Pass | Mean abs err (pts) |
|---|---|---|---|
| Chaparral | 3 | 67% | 10.4 |
| Cover crops | 20 | 85% | 10.7 |
| Dry grass | 22 | 68% | 11.3 |
| Grasslands of California | 23 | 83% | 12.0 |
| Lawns | 21 | 81% | 8.7 |
| Vineyards in California | 18 | 67% | 22.6 |
| own | 4 | 25% | 17.1 |
| **all** | 111 | 75% | |

- Dirt false positives (bare-soil + dirt-road buckets, risk over 3% of frame): 0/0
- VegAnn background false positives: mean 0.0% of background pixels read as risk; 0/0 images over 5%
- "All clear" while risk is drawn (must be 0): **0**

## Worst 20

| Image | Bucket | Ours | Expected | Why |
|---|---|---|---|---|
| [grasslands-of-california-24246124](https://commons.wikimedia.org/wiki/File:SantaRosaPlateaugrassland.JPG) | Grasslands of California | 0% | 95% | dry% off by 95 |
| [vineyards-in-california-16895865](https://commons.wikimedia.org/wiki/File:BOB_MARTINEZ_SPRAYING_GRAPE_VINES_-_NARA_-_542533.jpg) | Vineyards in California | 100% | 10% | dry% off by 90 |
| [vineyards-in-california-2553160](https://commons.wikimedia.org/wiki/File:Dorn_bay_clear_lake_state_park_ca.jpg) | Vineyards in California | 90% | 15% | dry% off by 75 |
| [cover-crops-48210681](https://commons.wikimedia.org/wiki/File:Cover_crops_in_Northwestern_South_Dakota_2015_(20115558362).jpg) | Cover crops | 12% | 80% | dry% off by 68 |
| [cover-crops-80580071](https://commons.wikimedia.org/wiki/File:Kremsm%C3%BCnster_Guntendorf-3849.jpg) | Cover crops | 0% | 55% | dry% off by 55 |
| [vineyards-in-california-132907263](https://commons.wikimedia.org/wiki/File:Bechthold_Vineyard_-_Cinsaut_-_planted_1886.jpg) | Vineyards in California | 64% | 10% | dry% off by 54 |
| [vineyards-in-california-61303863](https://commons.wikimedia.org/wiki/File:Bronco_Winery_Modesto_California.JPG) | Vineyards in California | 0% | 45% | dry% off by 45 |
| [vineyards-in-california-1190684](https://commons.wikimedia.org/wiki/File:California-grapesjpg.jpg) | Vineyards in California | 55% | 10% | dry% off by 45 |
| [lawns-10810140](https://commons.wikimedia.org/wiki/File:Blissfield_township_betz_airport.JPG) | Lawns | 79% | 35% | dry% off by 44 |
| [lawns-17908180](https://commons.wikimedia.org/wiki/File:Baltimore_and_Ohio_Railroad_Company_Depot_site.jpg) | Lawns | 100% | 60% | dry% off by 40 |
| [cover-crops-80580072](https://commons.wikimedia.org/wiki/File:Kremsm%C3%BCnster_Guntendorf-3850.jpg) | Cover crops | 3% | 35% | dry% off by 32 |
| [dry-grass-25124001](https://commons.wikimedia.org/wiki/File:Agropyron_dasystachyum_and_bull_snake_(4010792912).jpg) | Dry grass | 40% | 70% | dry% off by 30 |
| [dry-grass-29207309](https://commons.wikimedia.org/wiki/File:Blowing_in_the_breeze_(5822375129)_(2).jpg) | Dry grass | 93% | 65% | dry% off by 28 |
| [vineyards-in-california-132907264](https://commons.wikimedia.org/wiki/File:Brovelli_Ranch_-_Zinfandel_-_planted_1954.jpg) | Vineyards in California | 47% | 20% | dry% off by 27 |
| [own-srv1](local:test-photos) | own | 4% | 30% | dry% off by 26 |
| [dry-grass-11493848](https://commons.wikimedia.org/wiki/File:Buchloe_dactyloides.jpg) | Dry grass | 96% | 70% | dry% off by 26 |
| [dry-grass-27443632](https://commons.wikimedia.org/wiki/File:Abra.jpg) | Dry grass | 71% | 45% | dry% off by 26 |
| [lawns-10601967](https://commons.wikimedia.org/wiki/File:Ballet_flat_in_the_Westpark_in_Bochum.JPG) | Lawns | 0% | 25% | dry% off by 25 |
| [lawns-55651972](https://commons.wikimedia.org/wiki/File:Arrosage_des_pelouses.jpg) | Lawns | 48% | 25% | dry% off by 23 |
| [grasslands-of-california-55064873](https://commons.wikimedia.org/wiki/File:August_2012_-_panoramio_(48).jpg) | Grasslands of California | 3% | 25% | dry% off by 22 |

## Probable label errors (GPT estimate looks wrong; not tuned to)

| Image | Bucket | Ours | GPT | Reason |
|---|---|---|---|---|
| [dry-grass-49093863](https://commons.wikimedia.org/wiki/File:Boukornine_8.jpg) | Dry grass | 98% | 55% | note says bare ground |
| [dry-grass-57336474](https://commons.wikimedia.org/wiki/File:Autumn_on_the_New_River_Trail_(32684965271).jpg) | Dry grass | 91% | 45% | note says bare ground |
| [grasslands-of-california-30868722](https://commons.wikimedia.org/wiki/File:Distant_view_of_snow-capped_Mount_San_Antonio_(or_Mount_Baldy),_ca.1920_(CHS-5558).jpg) | Grasslands of California | 0% | 50% | snow or monochrome scene, no rateable vegetation |
| [vineyards-in-california-132914886](https://commons.wikimedia.org/wiki/File:Bishofberger_Vineyard_-Carignan_-_planted_1936.jpg) | Vineyards in California | 100% | 55% | note says bare ground |
| [vineyards-in-california-153752124](https://commons.wikimedia.org/wiki/File:California_Vineyard,_1933.jpg) | Vineyards in California | 100% | 25% | note says snow/monochrome |
| [vineyards-in-california-30872782](https://commons.wikimedia.org/wiki/File:Chinese_farm_workers_pruning_a_vineyard,_ca.1900_(CHS-1372).jpg) | Vineyards in California | 0% | 80% | snow or monochrome scene, no rateable vegetation |
| [vineyards-in-california-71307643](https://commons.wikimedia.org/wiki/File:500px_photo_(27949905).jpeg) | Vineyards in California | 0% | 75% | snow or monochrome scene, no rateable vegetation |
| [vineyards-in-california-73797141](https://commons.wikimedia.org/wiki/File:A_California_vineyard_covered_in_snow.jpg) | Vineyards in California | 0% | 70% | snow or monochrome scene, no rateable vegetation |
