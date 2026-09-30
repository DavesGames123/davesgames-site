# Tidal currents data tools

These tools make the datasets in `../data/` from NOAA Operational Forecast System (OFS) nowcasts.

- `locations.json` holds the locations: core bbox, labels, title lines, region and caption (blurb).
- `fetch_ofs.py` gets the surface `u`, `v` and `temp` for each hour from the NOAA S3 bucket. It uses HTTP range reads (`httpfile.py`), so it does not download full files. It checks the time in each file against the wanted hour.
- `build_data.py` rasterizes the fields for each location. It compresses them with EOFs and writes the PNG, WebP and JSON files that the page reads (format version 2).

## Usage

Run these commands from `stella-nova/pages/tidal-currents/`.

```sh
mkdir -p /tmp/ofs
for m in sscofs sfbofs lmhofs ciofs cbofs dbofs tbofs leofs ngofs2; do
  python3 tools/fetch_ofs.py $m 6 --out /tmp/ofs/cache
done
python3 tools/fetch_ofs.py gomofs 6 --out /tmp/ofs/cache --start 2026-09-21T03 --hours 176
python3 tools/fetch_grid.py nyofs --out /tmp/ofs/cache
python3 tools/fetch_grid.py neatl --out /tmp/ofs/cache --start 2026-09-22T23 --hours 169 --bbox=-7.0,52.7,-5.0,54.0
python3 tools/build_data.py --cache /tmp/ofs/cache
python3 tools/build_data.py --cache /tmp/ofs/cache --only sf-bay --quicklook /tmp/ofs/quicklook
```

`fetch_grid.py` reads the models that `fetch_ofs.py` cannot: NYOFS (POM, NetCDF3, no temperature, so the temperature is the NOAA gauge at the Battery) and the Irish Marine Institute NEATL model (ERDDAP). ERDDAP keeps NEATL for about 11 days only, so fetch a past week soon. Its cache has u and v east/north at the rho points, and `build_data.py` reads it as a ROMS grid.

The default fetch window is 175 hours from 2026-09-21 04:00 UTC. GOMOFS needs the earlier start, because Atlantic time (UTC-3) starts the local week at 03:00 UTC. The CIOFS and CBOFS files are large, so their fetches are slow.

`build_data.py` downloads Natural Earth 10m land and lakes into `<cache>/naturalearth/` on the first run. It prints the explained variance, the file sizes, the decode error against the raw fields, and a current time series at one probe point for each location. `--quicklook DIR` writes a speed plot with the coast, the core bbox, the labels and the fade seeds.

Requirements: python3 with numpy, scipy, matplotlib, pillow and h5py.

## Models

| Model | Grid | File | Cycles (UTC) |
|---|---|---|---|
| SSCOFS, SFBOFS | FVCOM | `fields.nNNN` | 03, 09, 15, 21 |
| LMHOFS, LEOFS | FVCOM | `fields.nNNN` | 00, 06, 12, 18 |
| NGOFS2 | FVCOM | `2ds.nNNN` (surface only) | 03, 09, 15, 21 |
| CIOFS, CBOFS, DBOFS, TBOFS | ROMS | `fields.nNNN` | 00, 06, 12, 18 |
| GOMOFS | ROMS | `2ds.nNNN` (surface only) | 00, 06, 12, 18 |

Nowcast file `nNNN` of cycle `C` holds the hour `C - 6 + NNN`.

## Notes

- Extent: the core bbox grows about its center until it holds the core at aspect 1.78 and at aspect 0.5. Pixels are square in metres. The long side is 1280 px, but a pixel is never finer than half the model cell size (20th percentile of the cells in the core).
- Mask: `mask.png` is at 2x the field resolution. `base.png` R is the same coverage at field resolution.
- FVCOM: the water coverage comes from the model triangles. Element velocities go to the nodes as a mean, then to the pixels with barycentric weights.
- ROMS: each grid cell with a water corner splits into two triangles, which give each pixel its grid index. `mask_rho` also marks dry intertidal cells as water, so a cell stays water only when it is wet for at least half of the hours.
- Open-boundary fade: pixels outside the model that Natural Earth calls sea or lake (more than 1 km from its land, in patches of at least 25 km2) are seeds. The water fades out over 40 mask px from the seeds. The optional `openBoundaryFade` boxes in `locations.json` add seeds by hand.
- A gap of one or two missing hours gets a linear fill in time. A longer gap stops the build for that location.
