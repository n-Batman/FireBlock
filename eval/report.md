# Scanner eval

Images in manifest: 167. Dropped as irrelevant by GPT: 12. Scored: 155 (14 flagged as probable label errors and left out of the rates). Failed: 0.
Pass = dry% within 15 pts of GPT's estimate; dirt buckets also need risk under 3% of the frame; VegAnn needs risk on under 5% of background pixels.

| Bucket | n | Pass | Mean abs err (pts) |
|---|---|---|---|
| Chaparral | 3 | 67% | 14.4 |
| Cover crops | 20 | 85% | 11.4 |
| Dry grass | 22 | 68% | 10.1 |
| Grasslands of California | 22 | 68% | 22.4 |
| Lawns | 21 | 86% | 7.9 |
| Vineyards in California | 16 | 63% | 25.1 |
| bare soil field | 6 | 33% | 16.5 |
| dirt road | 21 | 24% | 20.1 |
| own | 10 | 40% | 35.7 |
| **all** | 141 | 62% | |

- Dirt false positives (bare-soil + dirt-road buckets, risk over 3% of frame): 14/27
- VegAnn background false positives: mean 0.0% of background pixels read as risk; 0/0 images over 5%
- "All clear" while risk is drawn (must be 0): **0**

## Worst 20

| Image | Bucket | Ours | Expected | Why |
|---|---|---|---|---|
| [vineyards-in-california-16895865](https://commons.wikimedia.org/wiki/File:BOB_MARTINEZ_SPRAYING_GRAPE_VINES_-_NARA_-_542533.jpg) | Vineyards in California | 100% | 0% | dry% off by 100 |
| [dirt-road-92679918](https://commons.wikimedia.org/wiki/File:20191213_Dirt_road,_Thar_Desert,_Bikaner,_1325_8425.jpg) | dirt road | 99% | 0% | dry% off by 99 |
| [grasslands-of-california-55064873](https://commons.wikimedia.org/wiki/File:August_2012_-_panoramio_(48).jpg) | Grasslands of California | 3% | 98% | dry% off by 95 |
| [grasslands-of-california-24246124](https://commons.wikimedia.org/wiki/File:SantaRosaPlateaugrassland.JPG) | Grasslands of California | 0% | 95% | dry% off by 95 |
| [vineyards-in-california-69780723](https://commons.wikimedia.org/wiki/File:Caffeinated_zeitgeist_-_9594078321.jpg) | Vineyards in California | 0% | 95% | dry% off by 95 |
| [own-srv4](local:test-photos) | own | 5% | 98% | dry% off by 93 |
| [vineyards-in-california-64149982](https://commons.wikimedia.org/wiki/File:California_Vineyards_(15577868872).jpg) | Vineyards in California | 0% | 85% | dry% off by 85 |
| [dirt-road-92655067](https://commons.wikimedia.org/wiki/File:20191213_Ulica_wioski_Himtasar_w_Indiach_1137_8393.jpg) | dirt road | 77% | 0% | dirt read as risk (5% of frame) |
| [own-srv3](local:test-photos) | own | 0% | 75% | dry% off by 75 |
| [grasslands-of-california-55064952](https://commons.wikimedia.org/wiki/File:August_2012_-_panoramio_(50).jpg) | Grasslands of California | 26% | 100% | dry% off by 74 |
| [cover-crops-48210681](https://commons.wikimedia.org/wiki/File:Cover_crops_in_Northwestern_South_Dakota_2015_(20115558362).jpg) | Cover crops | 12% | 85% | dry% off by 73 |
| [cover-crops-80580071](https://commons.wikimedia.org/wiki/File:Kremsm%C3%BCnster_Guntendorf-3849.jpg) | Cover crops | 0% | 65% | dry% off by 65 |
| [own-srv9](local:test-photos) | own | 27% | 85% | dry% off by 58 |
| [dirt-road-92391675](https://commons.wikimedia.org/wiki/File:Tortuous_dirt_road_in_wet_paddy_fields_and_green_hills_in_Vang_Vieng,_Laos.jpg) | dirt road | 58% | 5% | dirt read as risk (19% of frame) |
| [grasslands-of-california-55064992](https://commons.wikimedia.org/wiki/File:August_2012_-_panoramio_(57).jpg) | Grasslands of California | 45% | 98% | dry% off by 53 |
| [grasslands-of-california-55064668](https://commons.wikimedia.org/wiki/File:August_2012_-_panoramio_(35).jpg) | Grasslands of California | 51% | 98% | dry% off by 47 |
| [lawns-10810140](https://commons.wikimedia.org/wiki/File:Blissfield_township_betz_airport.JPG) | Lawns | 79% | 35% | dry% off by 44 |
| [dry-grass-49093863](https://commons.wikimedia.org/wiki/File:Boukornine_8.jpg) | Dry grass | 98% | 55% | dry% off by 43 |
| [own-srv10](local:test-photos) | own | 2% | 45% | dry% off by 43 |
| [bare-soil-field-107999407](https://commons.wikimedia.org/wiki/File:Coastal_erosion_at_Thornwick_Bay_-_bare_soil_-_geograph.org.uk_-_2411926.jpg) | bare soil field | 43% | 0% | dry% off by 43 |

## Probable label errors (GPT estimate looks wrong; not tuned to)

| Image | Bucket | Ours | GPT | Reason |
|---|---|---|---|---|
| [bare-soil-field-13103759](https://commons.wikimedia.org/wiki/File:Bare_field_adjacent_to_Cupola_Farm_-_geograph.org.uk_-_579587.jpg) | bare soil field | 0% | 45% | note says bare ground |
| [bare-soil-field-13919394](https://commons.wikimedia.org/wiki/File:Bare_soil_in_a_large_field_-_geograph.org.uk_-_1204334.jpg) | bare soil field | 0% | 100% | note says bare ground |
| [dirt-road-40489878](https://commons.wikimedia.org/wiki/File:Palo_Alto_Baylands_January_2013_002.jpg) | dirt road | 64% | 35% | note says bare ground |
| [dirt-road-53370701](https://commons.wikimedia.org/wiki/File:-_panoramio_(1689).jpg) | dirt road | 100% | 70% | note says bare ground |
| [dirt-road-8694322](https://commons.wikimedia.org/wiki/File:Dirt_road_in_winter.JPG) | dirt road | 0% | 80% | note says snow/monochrome |
| [dry-grass-57336474](https://commons.wikimedia.org/wiki/File:Autumn_on_the_New_River_Trail_(32684965271).jpg) | Dry grass | 91% | 40% | note says bare ground |
| [grasslands-of-california-30868722](https://commons.wikimedia.org/wiki/File:Distant_view_of_snow-capped_Mount_San_Antonio_(or_Mount_Baldy),_ca.1920_(CHS-5558).jpg) | Grasslands of California | 0% | 50% | snow or monochrome scene, no rateable vegetation |
| [grasslands-of-california-55064381](https://commons.wikimedia.org/wiki/File:August_2012_-_panoramio_(23).jpg) | Grasslands of California | 100% | 98% | note says bare ground |
| [vineyards-in-california-132907263](https://commons.wikimedia.org/wiki/File:Bechthold_Vineyard_-_Cinsaut_-_planted_1886.jpg) | Vineyards in California | 64% | 75% | note says bare ground |
| [vineyards-in-california-132914886](https://commons.wikimedia.org/wiki/File:Bishofberger_Vineyard_-Carignan_-_planted_1936.jpg) | Vineyards in California | 100% | 100% | note says bare ground |
| [vineyards-in-california-132914888](https://commons.wikimedia.org/wiki/File:Bonnotto_Vineyard_-_Zinfandel_-_Tokay_sandy_loam_soil_-_planted_1930s.jpg) | Vineyards in California | 2% | 100% | note says bare ground |
| [vineyards-in-california-153752124](https://commons.wikimedia.org/wiki/File:California_Vineyard,_1933.jpg) | Vineyards in California | 100% | 80% | note says snow/monochrome |
| [vineyards-in-california-25375510](https://commons.wikimedia.org/wiki/File:Chateau_Julien_Winery,_Carmel,_California,_USA_(8254423245).jpg) | Vineyards in California | 4% | 70% | note says bare ground |
| [vineyards-in-california-30872782](https://commons.wikimedia.org/wiki/File:Chinese_farm_workers_pruning_a_vineyard,_ca.1900_(CHS-1372).jpg) | Vineyards in California | 0% | 90% | snow or monochrome scene, no rateable vegetation |
