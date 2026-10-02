// ============================================================================
//  IMG2THREEJS  ·  models/catalog.js — the three models and their build passes
// ----------------------------------------------------------------------------
//  Written from each ObjectSculptSpec (reviewHistory) when the models were built
//  with the img2threejs skill. One entry per model: the reference credit, the
//  factory name, the review camera, and per pass the factory file, the AI
//  vision score, the summary and the recorded mismatches. sameAs names the
//  earlier pass whose generated factory this pass equals (no model change).
// ============================================================================
export const MODELS = [
 {
  "id": "kettle",
  "title": "Copper tea kettle",
  "factory": "createCopperTeaKettleModel",
  "view": {
   "az": 0,
   "el": 12
  },
  "components": 10,
  "materials": [
   "hammered-copper",
   "copper-smooth",
   "wrought-wire"
  ],
  "ref": "refs/kettle.jpg",
  "credit": {
   "artist": "Clyde L. Cheney",
   "work": "Copper Tea Kettle, 1935-1942",
   "id": "NGA 27044",
   "source": "National Gallery of Art, Index of American Design",
   "url": "https://commons.wikimedia.org/wiki/File:Clyde_L._Cheney,_Copper_Tea_Kettle,_1935-1942,_NGA_27044.jpg",
   "licence": "CC0 1.0"
  },
  "passes": [
   {
    "id": "blockout",
    "file": "models/kettle/blockout.js",
    "sameAs": null,
    "score": 0.74,
    "layers": {
     "silhouetteProportion": 0.78,
     "componentStructure": 0.7,
     "formDetail": 0.62,
     "materialSurface": 0.7,
     "lightingCamera": 0.75
    },
    "summary": "Blockout after one refine-spec loop (first render: open lathe showed a white disc, spout thin and faceted, bail too tall and polygonal). Squat body, S-spout and tall bail now match the reference silhouette.",
    "mismatches": [
     "spout root slightly too far out",
     "bail shows a pale streak from crop contamination"
    ]
   },
   {
    "id": "structural-pass",
    "file": "models/kettle/structural-pass.js",
    "sameAs": null,
    "score": 0.76,
    "layers": {
     "silhouetteProportion": 0.79,
     "componentStructure": 0.8,
     "formDetail": 0.66,
     "materialSurface": 0.68,
     "lightingCamera": 0.75
    },
    "summary": "Structural pass after one refine-spec loop (lid profile wound inward and rendered hollow; lathe seam faced the camera, body turned by pi). Collar, seated lid, knob, foot ring, spout socket and lugs are present and attached.",
    "mismatches": [
     "lugs small and mostly hidden behind the bail ends",
     "texture tiles show edges on the wall"
    ]
   },
   {
    "id": "form-refinement",
    "file": "models/kettle/form-refinement.js",
    "sameAs": null,
    "score": 0.77,
    "layers": {
     "silhouetteProportion": 0.81,
     "componentStructure": 0.8,
     "formDetail": 0.7,
     "materialSurface": 0.68,
     "lightingCamera": 0.75
    },
    "summary": "Form refinement: wall made near-vertical with a tighter shoulder radius to match the reference drum; spout taper and bail bends kept.",
    "mismatches": [
     "hammered dents read only as texture, not as faceted geometry"
    ]
   },
   {
    "id": "material-pass",
    "file": "models/kettle/material-pass.js",
    "sameAs": null,
    "score": 0.72,
    "layers": {
     "silhouetteProportion": 0.82,
     "componentStructure": 0.8,
     "formDetail": 0.72,
     "materialSurface": 0.7,
     "lightingCamera": 0.72
    },
    "summary": "Material pass after two refine-spec loops (mirrored 2x2 tile read as a kaleidoscope; now one wrap of the reference wall around the lathe; tighter spout and wire crops removed paper pixels). Bail reshaped to the reference S-curve with hooks at the collar edge.",
    "mismatches": [
     "copper reads darker and less blotchy than the watercolour: the extractor de-lit the albedo"
    ]
   },
   {
    "id": "surface-pass",
    "file": "models/kettle/surface-pass.js",
    "sameAs": null,
    "score": 0.72,
    "layers": {
     "silhouetteProportion": 0.82,
     "componentStructure": 0.8,
     "formDetail": 0.72,
     "materialSurface": 0.71,
     "lightingCamera": 0.74
    },
    "summary": "Surface pass after one refine-code loop (normal 0.85 read as bark; now 0.42 with bump 0.025). Hammered relief and oxidised cavities read on body and lid; spout stays smooth drawn copper.",
    "mismatches": [
     "dents are finer than the large hammer facets in the watercolour",
     "the upscaled crop shows slight blocking on the shoulder"
    ]
   },
   {
    "id": "lighting-pass",
    "file": "models/kettle/surface-pass.js",
    "sameAs": "surface-pass",
    "score": 0.73,
    "layers": {
     "silhouetteProportion": 0.82,
     "componentStructure": 0.8,
     "formDetail": 0.72,
     "materialSurface": 0.71,
     "lightingCamera": 0.76
    },
    "summary": "lighting-pass: generated factory renders the same reviewed model; lighting uses the factory look-dev rig (warm key upper left, hemi fill, rim) with ACES tone mapping and contact shadow; envMapIntensity 1.25 on the copper.",
    "mismatches": [
     "copper still a little darker than the watercolour"
    ]
   },
   {
    "id": "interaction-pass",
    "file": "models/kettle/surface-pass.js",
    "sameAs": "surface-pass",
    "score": 0.73,
    "layers": {
     "silhouetteProportion": 0.82,
     "componentStructure": 0.8,
     "formDetail": 0.72,
     "materialSurface": 0.71,
     "lightingCamera": 0.76
    },
    "summary": "interaction-pass: generated factory renders the same reviewed model; lighting uses the factory look-dev rig (warm key upper left, hemi fill, rim) with ACES tone mapping and contact shadow; envMapIntensity 1.25 on the copper.",
    "mismatches": [
     "copper still a little darker than the watercolour"
    ]
   },
   {
    "id": "optimization-pass",
    "file": "models/kettle/surface-pass.js",
    "sameAs": "surface-pass",
    "score": 0.73,
    "layers": {
     "silhouetteProportion": 0.82,
     "componentStructure": 0.8,
     "formDetail": 0.72,
     "materialSurface": 0.71,
     "lightingCamera": 0.76
    },
    "summary": "optimization-pass: generated factory renders the same reviewed model; lighting uses the factory look-dev rig (warm key upper left, hemi fill, rim) with ACES tone mapping and contact shadow; envMapIntensity 1.25 on the copper.",
    "mismatches": [
     "copper still a little darker than the watercolour"
    ]
   }
  ]
 },
 {
  "id": "chair",
  "title": "Painted wooden chair",
  "factory": "createPaintedWoodenArmchairModel",
  "view": {
   "az": 40,
   "el": 25
  },
  "components": 20,
  "materials": [
   "painted-green",
   "painted-dark"
  ],
  "ref": "refs/chair.jpg",
  "credit": {
   "artist": "Clyde L. Cheney",
   "work": "Wooden Chair, c. 1938",
   "id": "NGA 16658",
   "source": "National Gallery of Art, Index of American Design",
   "url": "https://commons.wikimedia.org/wiki/File:Clyde_L._Cheney,_Wooden_Chair,_c._1938,_NGA_16658.jpg",
   "licence": "CC0 1.0"
  },
  "passes": [
   {
    "id": "blockout",
    "file": "models/chair/blockout.js",
    "sameAs": null,
    "score": 0.74,
    "layers": {
     "silhouetteProportion": 0.76,
     "componentStructure": 0.74,
     "formDetail": 0.64,
     "materialSurface": 0.6,
     "lightingCamera": 0.74
    },
    "summary": "Blockout after four refine-spec loops (tall narrow chair; thin parts; seat missing from the blockout list, which the feature gate refused; seat too high at 0.46 of the height, now 0.36). Low wide boxed seat, chunky posts carrying arms, leaning stiles and a round rolled crest at the reference three-quarter angle.",
    "mismatches": [
     "back slats not yet built",
     "paint too pale",
     "stiles straighter than the reference S-curve"
    ]
   },
   {
    "id": "structural-pass",
    "file": "models/chair/structural-pass.js",
    "sameAs": null,
    "score": 0.76,
    "layers": {
     "silhouetteProportion": 0.77,
     "componentStructure": 0.8,
     "formDetail": 0.66,
     "materialSurface": 0.6,
     "lightingCamera": 0.74
    },
    "summary": "Structural pass: two back slats, lower back rail, side and back aprons and six seat slats placed and attached to the frame; the chair reads as the reference armchair.",
    "mismatches": [
     "paint too pale",
     "stiles lack the soft S-curve"
    ]
   },
   {
    "id": "form-refinement",
    "file": "models/chair/form-refinement.js",
    "sameAs": null,
    "score": 0.76,
    "layers": {
     "silhouetteProportion": 0.78,
     "componentStructure": 0.8,
     "formDetail": 0.7,
     "materialSurface": 0.6,
     "lightingCamera": 0.74
    },
    "summary": "Form refinement: stiles given the soft S-curve (vertical to the seat, then leaning back in a long curve); arm fronts taper to rounded overhangs.",
    "mismatches": [
     "paint too pale"
    ]
   },
   {
    "id": "material-pass",
    "file": "models/chair/material-pass.js",
    "sameAs": null,
    "score": 0.71,
    "layers": {
     "silhouetteProportion": 0.78,
     "componentStructure": 0.8,
     "formDetail": 0.7,
     "materialSurface": 0.7,
     "lightingCamera": 0.74
    },
    "summary": "Material pass after three refine-spec loops (lit slat crop rendered pale; apron crop with slat gaps tiled into stripes; leg crop put brown blotches on the crest). Now a mid-green apron strip with one wrap per face and the clean slat crop on the crest.",
    "mismatches": [
     "brown wear strokes run diagonally on the slats and are busier than the watercolour"
    ]
   },
   {
    "id": "surface-pass",
    "file": "models/chair/material-pass.js",
    "sameAs": "material-pass",
    "score": 0.72,
    "layers": {
     "silhouetteProportion": 0.78,
     "componentStructure": 0.8,
     "formDetail": 0.7,
     "materialSurface": 0.71,
     "lightingCamera": 0.75
    },
    "summary": "surface-pass: generated factory renders the reviewed chair; surface detail is the paint-wear map at low normal strength; look-dev rig with soft key upper left, hemi fill, ACES tone mapping and contact shadow.",
    "mismatches": [
     "brown wear strokes busier than the watercolour"
    ]
   },
   {
    "id": "lighting-pass",
    "file": "models/chair/material-pass.js",
    "sameAs": "material-pass",
    "score": 0.72,
    "layers": {
     "silhouetteProportion": 0.78,
     "componentStructure": 0.8,
     "formDetail": 0.7,
     "materialSurface": 0.71,
     "lightingCamera": 0.75
    },
    "summary": "lighting-pass: generated factory renders the reviewed chair; surface detail is the paint-wear map at low normal strength; look-dev rig with soft key upper left, hemi fill, ACES tone mapping and contact shadow.",
    "mismatches": [
     "brown wear strokes busier than the watercolour"
    ]
   },
   {
    "id": "interaction-pass",
    "file": "models/chair/material-pass.js",
    "sameAs": "material-pass",
    "score": 0.72,
    "layers": {
     "silhouetteProportion": 0.78,
     "componentStructure": 0.8,
     "formDetail": 0.7,
     "materialSurface": 0.71,
     "lightingCamera": 0.75
    },
    "summary": "interaction-pass: generated factory renders the reviewed chair; surface detail is the paint-wear map at low normal strength; look-dev rig with soft key upper left, hemi fill, ACES tone mapping and contact shadow.",
    "mismatches": [
     "brown wear strokes busier than the watercolour"
    ]
   },
   {
    "id": "optimization-pass",
    "file": "models/chair/material-pass.js",
    "sameAs": "material-pass",
    "score": 0.72,
    "layers": {
     "silhouetteProportion": 0.78,
     "componentStructure": 0.8,
     "formDetail": 0.7,
     "materialSurface": 0.71,
     "lightingCamera": 0.75
    },
    "summary": "optimization-pass: generated factory renders the reviewed chair; surface detail is the paint-wear map at low normal strength; look-dev rig with soft key upper left, hemi fill, ACES tone mapping and contact shadow.",
    "mismatches": [
     "brown wear strokes busier than the watercolour"
    ]
   }
  ]
 },
 {
  "id": "lantern",
  "title": "Pierced tin lantern",
  "factory": "createPiercedTinLanternModel",
  "view": {
   "az": 0,
   "el": 8
  },
  "components": 53,
  "materials": [
   "pierced-tin",
   "plain-tin",
   "globe-glass",
   "iron-wire",
   "grip-wood"
  ],
  "ref": "refs/lantern.jpg",
  "credit": {
   "artist": "Alfred Farrell",
   "work": "Coal Oil Lantern, c. 1939",
   "id": "NGA 24331",
   "source": "National Gallery of Art, Index of American Design",
   "url": "https://commons.wikimedia.org/wiki/File:Alfred_Farrell,_Coal_Oil_Lantern,_c._1939,_NGA_24331.jpg",
   "licence": "CC0 1.0"
  },
  "passes": [
   {
    "id": "blockout",
    "file": "models/lantern/blockout.js",
    "sameAs": null,
    "score": 0.72,
    "layers": {
     "silhouetteProportion": 0.76,
     "componentStructure": 0.66,
     "formDetail": 0.62,
     "materialSurface": 0.62,
     "lightingCamera": 0.72
    },
    "summary": "Blockout after three refine-spec loops (globe and cap too tall, now measured as foot-width ratios; the wrapped star band and tin crop read as dark wood, tin is now a textureless metal; binary metalness mirrored a dark room, now rougher with a stronger environment). Foot, drum, globe, cap and bail stack match the reference outline.",
    "mismatches": [
     "cage, burner, stars and grip come in the structural pass",
     "globe reads milky"
    ]
   },
   {
    "id": "structural-pass",
    "file": "models/lantern/structural-pass.js",
    "sameAs": null,
    "score": 0.77,
    "layers": {
     "silhouetteProportion": 0.8,
     "componentStructure": 0.8,
     "formDetail": 0.7,
     "materialSurface": 0.66,
     "lightingCamera": 0.74
    },
    "summary": "Structural pass: six bowed cage wires with equator and base rings, burner with four gallery rings visible through the globe, 34 star piercings on drum and cap, bail with a turned grip.",
    "mismatches": [
     "stars too small to read on the drum"
    ]
   },
   {
    "id": "form-refinement",
    "file": "models/lantern/form-refinement.js",
    "sameAs": null,
    "score": 0.77,
    "layers": {
     "silhouetteProportion": 0.8,
     "componentStructure": 0.8,
     "formDetail": 0.74,
     "materialSurface": 0.66,
     "lightingCamera": 0.74
    },
    "summary": "Form refinement: stars enlarged 1.5x to the measured ~0.1 dm piercing size so both rows read on the drum; cage bow and globe taper kept.",
    "mismatches": [
     "drum tin darker than the drawing"
    ]
   },
   {
    "id": "material-pass",
    "file": "models/lantern/material-pass.js",
    "sameAs": null,
    "score": 0.74,
    "layers": {
     "silhouetteProportion": 0.8,
     "componentStructure": 0.8,
     "formDetail": 0.74,
     "materialSurface": 0.7,
     "lightingCamera": 0.74
    },
    "summary": "Material pass after two refine-spec loops (the generator's material-pass gate does not honour textureless, so tin needs reference maps; a long foot crop wrapped into a chevron weave, now a mirrored uniform tin patch; glass stays textureless with qualityTier utility and the reason recorded). Grey tinplate, clear globe showing the burner, dark wire, grey grip.",
    "mismatches": [
     "foot reads paler and creamier than the drawn tin",
     "globe slightly milky"
    ]
   },
   {
    "id": "surface-pass",
    "file": "models/lantern/material-pass.js",
    "sameAs": "material-pass",
    "score": 0.74,
    "layers": {
     "silhouetteProportion": 0.8,
     "componentStructure": 0.8,
     "formDetail": 0.74,
     "materialSurface": 0.7,
     "lightingCamera": 0.75
    },
    "summary": "surface-pass: generated factory renders the reviewed lantern (grey tin with built star piercings, transmissive globe, dark wire, grey grip); look-dev rig with ACES tone mapping and contact shadow.",
    "mismatches": [
     "foot paler than the drawn tin",
     "globe slightly milky"
    ]
   },
   {
    "id": "lighting-pass",
    "file": "models/lantern/material-pass.js",
    "sameAs": "material-pass",
    "score": 0.74,
    "layers": {
     "silhouetteProportion": 0.8,
     "componentStructure": 0.8,
     "formDetail": 0.74,
     "materialSurface": 0.7,
     "lightingCamera": 0.75
    },
    "summary": "lighting-pass: generated factory renders the reviewed lantern (grey tin with built star piercings, transmissive globe, dark wire, grey grip); look-dev rig with ACES tone mapping and contact shadow.",
    "mismatches": [
     "foot paler than the drawn tin",
     "globe slightly milky"
    ]
   },
   {
    "id": "interaction-pass",
    "file": "models/lantern/material-pass.js",
    "sameAs": "material-pass",
    "score": 0.74,
    "layers": {
     "silhouetteProportion": 0.8,
     "componentStructure": 0.8,
     "formDetail": 0.74,
     "materialSurface": 0.7,
     "lightingCamera": 0.75
    },
    "summary": "interaction-pass: generated factory renders the reviewed lantern (grey tin with built star piercings, transmissive globe, dark wire, grey grip); look-dev rig with ACES tone mapping and contact shadow.",
    "mismatches": [
     "foot paler than the drawn tin",
     "globe slightly milky"
    ]
   },
   {
    "id": "optimization-pass",
    "file": "models/lantern/material-pass.js",
    "sameAs": "material-pass",
    "score": 0.74,
    "layers": {
     "silhouetteProportion": 0.8,
     "componentStructure": 0.8,
     "formDetail": 0.74,
     "materialSurface": 0.7,
     "lightingCamera": 0.75
    },
    "summary": "optimization-pass: generated factory renders the reviewed lantern (grey tin with built star piercings, transmissive globe, dark wire, grey grip); look-dev rig with ACES tone mapping and contact shadow.",
    "mismatches": [
     "foot paler than the drawn tin",
     "globe slightly milky"
    ]
   }
  ]
 }
];
