# Scanner eval

Images in manifest: 127. Dropped as irrelevant by GPT: 8. Scored: 119. Failed: 0.
Pass = dry% within 15 pts of GPT's estimate; dirt buckets also need risk under 3% of the frame; VegAnn needs risk on under 5% of background pixels.

| Bucket | n | Pass | Mean abs err (pts) |
|---|---|---|---|
| Chaparral | 3 | 33% | 33.9 |
| Cover crops | 20 | 75% | 13.6 |
| Dry grass | 24 | 54% | 24.4 |
| Grasslands of California | 24 | 71% | 16.8 |
| Lawns | 21 | 81% | 11.3 |
| Vineyards in California | 23 | 52% | 30.3 |
| own | 4 | 25% | 33.3 |
| **all** | 119 | 64% | |

- Dirt false positives (bare-soil + dirt-road buckets, risk over 3% of frame): 0/0
- VegAnn background false positives: mean 0.0% of background pixels read as risk; 0/0 images over 5%
- "All clear" while risk is drawn (must be 0): **23** — chaparral-30429713, cover-crops-48210681, cover-crops-65891127, grasslands-of-california-10359984, grasslands-of-california-127341, grasslands-of-california-127346, grasslands-of-california-1682432, grasslands-of-california-52975455, lawns-10712165, lawns-10712167

## Worst 20

| Image | Bucket | Ours | Expected | Why |
|---|---|---|---|---|
| [dry-grass-24908567](https://commons.wikimedia.org/wiki/File:Brown_dead_grass.jpg) | Dry grass | 3% | 99% | dry% off by 96 |
| [grasslands-of-california-24246124](https://commons.wikimedia.org/wiki/File:SantaRosaPlateaugrassland.JPG) | Grasslands of California | 0% | 95% | dry% off by 95 |
| [vineyards-in-california-16895865](https://commons.wikimedia.org/wiki/File:BOB_MARTINEZ_SPRAYING_GRAPE_VINES_-_NARA_-_542533.jpg) | Vineyards in California | 100% | 10% | dry% off by 90 |
| [vineyards-in-california-132907263](https://commons.wikimedia.org/wiki/File:Bechthold_Vineyard_-_Cinsaut_-_planted_1886.jpg) | Vineyards in California | 91% | 10% | dry% off by 81 |
| [vineyards-in-california-30872782](https://commons.wikimedia.org/wiki/File:Chinese_farm_workers_pruning_a_vineyard,_ca.1900_(CHS-1372).jpg) | Vineyards in California | 0% | 80% | dry% off by 80 |
| [cover-crops-48210681](https://commons.wikimedia.org/wiki/File:Cover_crops_in_Northwestern_South_Dakota_2015_(20115558362).jpg) | Cover crops | 0% | 80% | dry% off by 80 |
| [chaparral-29551397](https://commons.wikimedia.org/wiki/File:Chaparral_clearing_at_Fort_Ord_Oct._15_(10601932275).jpg) | Chaparral | 0% | 75% | dry% off by 75 |
| [vineyards-in-california-71307643](https://commons.wikimedia.org/wiki/File:500px_photo_(27949905).jpeg) | Vineyards in California | 0% | 75% | dry% off by 75 |
| [own-srv9](local:test-photos) | own | 96% | 25% | dry% off by 71 |
| [vineyards-in-california-73797141](https://commons.wikimedia.org/wiki/File:A_California_vineyard_covered_in_snow.jpg) | Vineyards in California | 0% | 70% | dry% off by 70 |
| [dry-grass-40187093](https://commons.wikimedia.org/wiki/File:Ausgetrocknetes_grass.jpg) | Dry grass | 11% | 80% | dry% off by 69 |
| [dry-grass-25124001](https://commons.wikimedia.org/wiki/File:Agropyron_dasystachyum_and_bull_snake_(4010792912).jpg) | Dry grass | 4% | 70% | dry% off by 66 |
| [lawns-17908180](https://commons.wikimedia.org/wiki/File:Baltimore_and_Ohio_Railroad_Company_Depot_site.jpg) | Lawns | 0% | 60% | dry% off by 60 |
| [vineyards-in-california-2553160](https://commons.wikimedia.org/wiki/File:Dorn_bay_clear_lake_state_park_ca.jpg) | Vineyards in California | 69% | 15% | dry% off by 54 |
| [vineyards-in-california-3752472](https://commons.wikimedia.org/wiki/File:CaliforniaVineyard.jpg) | Vineyards in California | 59% | 5% | dry% off by 54 |
| [dry-grass-24908580](https://commons.wikimedia.org/wiki/File:Brown_dead_grass_weeds_and_leaves.jpg) | Dry grass | 47% | 98% | dry% off by 51 |
| [grasslands-of-california-30868722](https://commons.wikimedia.org/wiki/File:Distant_view_of_snow-capped_Mount_San_Antonio_(or_Mount_Baldy),_ca.1920_(CHS-5558).jpg) | Grasslands of California | 0% | 50% | dry% off by 50 |
| [dry-grass-57336474](https://commons.wikimedia.org/wiki/File:Autumn_on_the_New_River_Trail_(32684965271).jpg) | Dry grass | 93% | 45% | dry% off by 48 |
| [vineyards-in-california-132914886](https://commons.wikimedia.org/wiki/File:Bishofberger_Vineyard_-Carignan_-_planted_1936.jpg) | Vineyards in California | 100% | 55% | dry% off by 45 |
| [vineyards-in-california-61303863](https://commons.wikimedia.org/wiki/File:Bronco_Winery_Modesto_California.JPG) | Vineyards in California | 0% | 45% | dry% off by 45 |
