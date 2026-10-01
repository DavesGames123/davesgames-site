# Wear textures

Photographic imperfection maps for the wear on watch and clock parts
(wear.js). Each file is one grey channel: black is a clean surface, white is
the full mark. wear.js reads them as roughness and bump.

All three come from ambientCG and are CC0 1.0 Universal (public domain):
https://docs.ambientcg.com/license/

| File | Source asset | Map used | Source URL |
|---|---|---|---|
| wear-prints.jpg | Fingerprints003 (1K-JPG) | Roughness | https://ambientcg.com/view?id=Fingerprints003 |
| wear-scratches.jpg | Scratches003 (1K-JPG) | Opacity | https://ambientcg.com/view?id=Scratches003 |
| wear-smudges.jpg | SurfaceImperfections003 (1K-JPG) | Opacity | https://ambientcg.com/view?id=SurfaceImperfections003 |

Processing (ImageMagick): `-colorspace Gray -auto-level -resize 1024x1024`,
JPEG quality 85 (scratches 88), metadata stripped. The source maps tile
seamlessly, and the processed files keep that property.
