# Tidal currents data tools

These tools make the datasets in `../data/` from NOAA Operational Forecast System (OFS) nowcasts.

- `locations.json` holds the poster locations: bbox, raster size, labels and layout.
- `fetch_ofs.py` gets the surface `u`, `v` and `temp` for each hour from the NOAA S3 bucket. It uses HTTP range reads (`httpfile.py`), so it does not download full files.
- `build_data.py` rasterizes the fields for each location. It compresses them with EOFs and writes the PNG and JSON files that the page reads.

## Usage

Run these commands from `stella-nova/pages/tidal-currents/`.

```sh
mkdir -p /tmp/ofs
for m in sscofs sfbofs lmhofs ciofs; do python3 tools/fetch_ofs.py $m 6 --out /tmp/ofs/cache; done
python3 tools/build_data.py --cache /tmp/ofs/cache
python3 tools/build_data.py --cache /tmp/ofs/cache --only sf-bay --quicklook /tmp/ofs/quicklook
```

The default fetch window is 175 hours from 2026-09-21 04:00 UTC. The window covers the local week of every location. The CIOFS files are large, so the CIOFS fetch is slow (approximately 2 to 3 hours).

`build_data.py` prints the explained variance and the PNG sizes. It then decodes the PNGs with the page formula and prints the error against the raw fields. It also prints a current time series at one probe point for each location. `--quicklook DIR` writes a speed plot with the coast and the labels.

Requirements: python3 with numpy, scipy, matplotlib, pillow and h5py.

## Notes

- FVCOM models (SSCOFS, SFBOFS, LMHOFS): the water coverage comes from the model triangles. Element velocities go to the nodes as a mean, then to the pixels with barycentric weights.
- ROMS model (CIOFS): `mask_rho` also marks dry intertidal cells as water. The script keeps a cell as water only when it is wet for at least half of the hours. A dry cell has a near-zero speed and a frozen temperature.
- A gap of one or two missing hours gets a linear fill in time. A longer gap stops the build for that location.
