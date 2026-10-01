#!/usr/bin/env python3
# ============================================================================
#  HUMAN SKELETON  ·  build-data.py — meshes to data/*.bin.gz + manifest
# ────────────────────────────────────────────────────────────────────────────
#  Reads the Z-Anatomy Blender template (CC BY-SA 4.0, made from
#  BodyParts3D by DBCLS) and writes one compact binary per body group plus
#  data/manifest.json. The page and tests.mjs read only those files.
#
#  RUN (bpy is the Blender Python module: pip install bpy)
#    python3 build-data.py --blend <Startup.blend> --bp3d <isa_parts_list_e.txt>
#    Startup.blend is in Z-Anatomy.zip:
#      github.com/Z-Anatomy/Models-of-human-anatomy (branch master)
#    isa_parts_list_e.txt gives the FMA ids:
#      dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/
#
#  STEPS
#    1. CATALOGUE  every bone: object names, English and Latin name, region,
#                  side, bone type, parent in the explode tree, a fact
#    2. EXTRACT    world-space triangles from the blend (z up, metres),
#                  then turned to y up with the face toward +z
#    3. DECIMATE   a triangle budget per bone from its surface area, by the
#                  Blender collapse decimator; a right bone is the mirror of
#                  the decimated left bone, so the pairs match exactly
#    4. SHADE      vertex normals and a cavity term from the mesh Laplacian
#    5. RELATE     articulations from mesh proximity (KD-trees), the joint
#                  point with the parent, principal axes for the tray pose
#    6. PACK       uint16 positions (per-bone box), int8 normals, uint8
#                  cavity, uint16 indices; one gzip file per body group
#
#  BINARY LAYOUT  (per bone, in manifest order inside its group file;
#                  every block starts on a 4-byte boundary)
#    pos  uint16 x3 per vertex   p = min + q / 65535 * size
#    nrm  int8   x3 per vertex   n = q / 127
#    cav  uint8  x1 per vertex   cavity 0..1
#    idx  uint16 x3 per triangle
#
#  OSSICLES  Z-Anatomy credits a CC BY-NC-SA ear model from the University
#    of Dundee, and that model contains the malleus, incus and stapes.
#    BodyParts3D has no ossicles. The six ossicles stay out unless you give
#    --ossicles, because their licence is not proven to be BY-SA.
#
#  GREP MAP
#    grep -n 'def catalogue'      the bone table (names, Latin, parents)
#    grep -n 'FACTS = '           the one-line fact for each bone kind
#    grep -n 'def extract'        blend objects to numpy triangles
#    grep -n 'def decimate'       the Blender collapse decimator
#    grep -n 'def shade'          normals and cavity
#    grep -n 'def relate'         articulations and joint points
#    grep -n 'def lay_pose'       principal axes for the catalogue tray
#    grep -n 'def pack'           the binary files and the manifest
# ============================================================================
import argparse, gzip, json, math, os, sys, time
import numpy as np
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
SIDE_WORD = {'L': 'Left', 'R': 'Right'}

# ── regions ─────────────────────────────────────────────────────────────────
# id, label, explode group (= data file), bones in the 206 count
REGIONS = [
    ('skull', 'Skull', 'head', 22), ('ear', 'Middle ear', 'head', 6), ('hyoid', 'Hyoid', 'head', 1),
    ('spine', 'Spine', 'spine', 26), ('thorax', 'Thorax', 'thorax', 25),
    ('shoulder-l', 'Shoulder (L)', 'upper-l', 2), ('arm-l', 'Arm (L)', 'upper-l', 3), ('hand-l', 'Hand (L)', 'upper-l', 27),
    ('shoulder-r', 'Shoulder (R)', 'upper-r', 2), ('arm-r', 'Arm (R)', 'upper-r', 3), ('hand-r', 'Hand (R)', 'upper-r', 27),
    ('pelvis', 'Pelvis', 'pelvis', 2),
    ('leg-l', 'Leg (L)', 'lower-l', 4), ('foot-l', 'Foot (L)', 'lower-l', 26),
    ('leg-r', 'Leg (R)', 'lower-r', 4), ('foot-r', 'Foot (R)', 'lower-r', 26),
    ('teeth', 'Teeth', 'head', 0), ('cartilage', 'Costal cartilage', 'cartilage', 0),
]
GROUPS = [('head', 'Head'), ('spine', 'Spine'), ('thorax', 'Thorax'), ('upper-l', 'Upper limb (L)'), ('upper-r', 'Upper limb (R)'),
          ('pelvis', 'Pelvis'), ('lower-l', 'Lower limb (L)'), ('lower-r', 'Lower limb (R)'), ('cartilage', 'Cartilage')]

# ── facts: one line per bone kind (the id without the side) ─────────────────
FACTS = {
    'frontal': 'Two halves at birth; the metopic suture between them usually closes by the second year.',
    'parietal': 'The largest bones of the vault meet at the sagittal suture along the top of the head.',
    'occipital': 'The spinal cord leaves the skull through its foramen magnum, the largest hole in the cranium.',
    'temporal': 'Holds the cochlea and the ossicles inside the petrous part, the densest bone in the body.',
    'sphenoid': 'The keystone of the skull: it touches every other cranial bone and cradles the pituitary.',
    'ethmoid': 'Light as a honeycomb; its air cells form the ethmoid sinuses between the eyes.',
    'nasal': 'Two small plates form the bridge of the nose; they are the facial bones most often broken.',
    'lacrimal': 'The smallest and most fragile facial bone, it holds the tear sac in the orbit wall.',
    'zygomatic': 'The cheekbone; it shapes the outer wall and floor of the orbit.',
    'maxilla': 'Holds the upper teeth and the largest paranasal sinus, the maxillary sinus.',
    'palatine': 'An L-shaped bone that forms the back of the hard palate.',
    'concha': 'A scroll of bone that warms and moistens air in the nasal cavity.',
    'vomer': 'A thin plough-shaped plate that forms the back of the nasal septum.',
    'mandible': 'The only skull bone that moves freely, and the strongest bone of the face.',
    'hyoid': 'The only bone that articulates with no other bone; muscles and ligaments hold it.',
    'malleus': 'The hammer: its handle is attached to the eardrum.',
    'incus': 'The anvil passes vibration from the malleus to the stapes.',
    'stapes': 'The stirrup is the smallest bone in the body, about 3 mm long.',
    'c1': 'The atlas has no body; it carries the skull and lets the head nod.',
    'c2': 'The dens of the axis is the pivot on which the atlas and the head turn.',
    'c7': 'Vertebra prominens: its long spinous process is the bump at the base of the neck.',
    'cervical': 'Cervical vertebrae have holes in their transverse processes for the vertebral arteries.',
    't1': 'The first thoracic vertebra carries a full facet for the head of the first rib.',
    'thoracic': 'Facets on its body and transverse processes carry the ribs.',
    't12': 'A transition vertebra: thoracic above, with lumbar-type joints below.',
    'lumbar': 'Lumbar vertebrae have the largest bodies; they carry the weight of the trunk.',
    'l5': 'The wedge-shaped L5 sits on the sacrum at the lumbosacral angle.',
    'sacrum': 'Five vertebrae fuse into the sacrum between the ages of about 16 and 30.',
    'coccyx': 'The tailbone: three to five small vertebrae fused into one.',
    'sternum': 'Manubrium, body and xiphoid process fuse into one flat bone; marrow biopsies use it.',
    'rib1': 'The first rib is the shortest, broadest and most curved rib.',
    'rib-true': 'A true rib joins the sternum directly through its own costal cartilage.',
    'rib-false': 'A false rib joins the sternum only through the cartilage of the rib above.',
    'rib-floating': 'A floating rib has no attachment to the sternum at the front.',
    'clavicle': 'The first bone to start ossifying in the embryo, and the last to finish.',
    'scapula': 'Held on the back by muscles only; it moves with the arm.',
    'humerus': 'The radial nerve winds around its shaft in the spiral groove.',
    'radius': 'Turns around the ulna to rotate the palm up and down.',
    'ulna': 'Its olecranon is the point of the elbow.',
    'scaphoid': 'The carpal bone most often broken, usually in a fall on an outstretched hand.',
    'lunate': 'A moon-shaped carpal at the centre of the proximal row.',
    'triquetrum': 'A pyramidal carpal with a facet for the pisiform.',
    'pisiform': 'A pea-sized sesamoid bone in the tendon of flexor carpi ulnaris.',
    'trapezium': 'Its saddle joint with the first metacarpal lets the thumb oppose.',
    'trapezoid': 'The smallest carpal of the distal row, wedged between trapezium and capitate.',
    'capitate': 'The largest carpal bone, at the centre of the wrist.',
    'hamate': 'Its hook is a landmark of the canal of Guyon.',
    'mc1': 'The shortest and thickest metacarpal; it moves on a saddle joint.',
    'mc': 'A metacarpal bone of the palm; its head forms the knuckle.',
    'pp-hand': 'A proximal phalanx of the hand.',
    'mp-hand': 'A middle phalanx of the hand; the thumb has none.',
    'dp-hand': 'A distal phalanx carries the fingernail on its tuft.',
    'pp-thumb': 'The thumb has two phalanges, not three.',
    'hip': 'Ilium, ischium and pubis fuse at the acetabulum at about age 16.',
    'femur': 'The longest and strongest bone, about a quarter of body height.',
    'patella': 'The largest sesamoid bone, inside the quadriceps tendon.',
    'tibia': 'The shin bone carries almost all the weight of the leg.',
    'fibula': 'Carries little weight; surgeons take parts of it for grafts.',
    'talus': 'No muscle attaches to it; the talus carries the body weight to the foot.',
    'calcaneus': 'The heel bone, the largest tarsal; the Achilles tendon inserts on it.',
    'navicular': 'A boat-shaped tarsal at the top of the medial arch.',
    'cuboid': 'Has a groove for the tendon of fibularis longus.',
    'cuneiform': 'One of three wedge-shaped tarsals that shape the transverse arch.',
    'mt1': 'The thickest metatarsal; it carries much of the push-off load.',
    'mt5': 'Its tuberosity is a common site of avulsion fracture.',
    'mt': 'A metatarsal bone; stress fractures often start in the second.',
    'pp-foot': 'A proximal phalanx of the foot.',
    'mp-foot': 'A middle phalanx of the foot; the big toe has none.',
    'dp-foot': 'A distal phalanx of a toe.',
    'tooth': 'Enamel is the hardest substance in the body.',
    'cartilage': 'Hyaline cartilage that joins a rib to the sternum and lets the chest expand.',
}

ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']
ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
GENDER_SIDE = {'m': ('dexter', 'sinister'), 'f': ('dextra', 'sinistra'), 'n': ('dextrum', 'sinistrum')}


def latin_side(latin, gender, side):
    if not side:
        return latin
    d, s = GENDER_SIDE[gender]
    return f'{latin} {d if side == "R" else s}'


def catalogue(ossicles):
    """The bone table. Each entry is a dict; side 'L', 'R' or ''."""
    out = []

    def add(id, objs, name, latin, region, btype, parent, fma, fact, side='', gender='n', counted=True, kind=None):
        out.append(dict(id=id, objs=objs, name=name, latin=latin_side(latin, gender, side), region=region, side=side,
                        type=btype, parent=parent, fmaName=fma, fact=FACTS[fact], counted=counted, kind=kind or fact))

    def pair(base, objbase, name, latin, region, btype, parent, fma, fact, gender='n', counted=True, kind=None):
        for side, sfx in (('L', 'l'), ('R', 'r')):
            reg = region.replace('{s}', sfx)
            par = parent.replace('{s}', sfx) if parent else None
            fm = fma.replace('{side}', SIDE_WORD[side].lower()) if fma else None
            objs = [o + '.' + sfx for o in (objbase if isinstance(objbase, list) else [objbase])]
            add(f'{base}-{sfx}', objs, name, latin, reg, btype, par, fm, fact, side, gender, counted, kind)

    # SKULL 22: 8 cranial, 14 facial. Parent of every skull bone: the sphenoid.
    add('frontal', ['Frontal bone'], 'Frontal bone', 'Os frontale', 'skull', 'flat', 'sphenoid', 'frontal bone', 'frontal')
    pair('parietal', 'Parietal bone', 'Parietal bone', 'Os parietale', 'skull', 'flat', 'sphenoid', '{side} parietal bone', 'parietal')
    add('occipital', ['Occipital bone'], 'Occipital bone', 'Os occipitale', 'skull', 'flat', 'c1', 'occipital bone', 'occipital')
    pair('temporal', 'Temporal bone', 'Temporal bone', 'Os temporale', 'skull', 'irregular', 'sphenoid', '{side} temporal bone', 'temporal')
    add('sphenoid', ['Sphenoid bone'], 'Sphenoid bone', 'Os sphenoidale', 'skull', 'irregular', 'occipital', 'sphenoid bone', 'sphenoid')
    add('ethmoid', ['Ethmoid bone'], 'Ethmoid bone', 'Os ethmoidale', 'skull', 'irregular', 'sphenoid', 'ethmoid', 'ethmoid')
    pair('nasal', 'Nasal bone', 'Nasal bone', 'Os nasale', 'skull', 'flat', 'sphenoid', '{side} nasal bone', 'nasal')
    pair('lacrimal', 'Lacrimal bone', 'Lacrimal bone', 'Os lacrimale', 'skull', 'flat', 'sphenoid', '{side} lacrimal bone', 'lacrimal')
    pair('zygomatic', 'Zygomatic bone', 'Zygomatic bone', 'Os zygomaticum', 'skull', 'irregular', 'sphenoid', '{side} zygomatic bone', 'zygomatic')
    pair('maxilla', 'Maxilla', 'Maxilla', 'Maxilla', 'skull', 'irregular', 'sphenoid', '{side} maxilla', 'maxilla', 'f')
    pair('palatine', 'Palatine bone', 'Palatine bone', 'Os palatinum', 'skull', 'irregular', 'sphenoid', '{side} palatine bone', 'palatine')
    pair('concha', 'Inferior nasal concha bone', 'Inferior nasal concha', 'Concha nasalis inferior', 'skull', 'irregular', 'sphenoid',
         '{side} inferior nasal concha', 'concha', 'f')
    add('vomer', ['Vomer'], 'Vomer', 'Vomer', 'skull', 'flat', 'sphenoid', 'vomer', 'vomer')
    add('mandible', ['Mandible'], 'Mandible', 'Mandibula', 'skull', 'irregular', 'sphenoid', 'mandible', 'mandible')
    # MIDDLE EAR 6 (see OSSICLES in the header)
    if ossicles:
        pair('malleus', 'Malleus', 'Malleus', 'Malleus', 'ear', 'irregular', 'temporal-{s}', None, 'malleus', 'm')
        pair('incus', 'Incus', 'Incus', 'Incus', 'ear', 'irregular', 'malleus-{s}', None, 'incus', 'f')
        pair('stapes', 'Stapes', 'Stapes', 'Stapes', 'ear', 'irregular', 'incus-{s}', None, 'stapes', 'm')
    add('hyoid', ['Hyoid bone'], 'Hyoid bone', 'Os hyoideum', 'hyoid', 'irregular', 'mandible', 'hyoid bone', 'hyoid')

    # SPINE 26: the sacrum is the root of the explode tree.
    add('c1', ['Atlas (C1)'], 'Atlas (C1)', 'Atlas', 'spine', 'irregular', 'c2', 'atlas', 'c1', gender='m')
    add('c2', ['Axis (C2)'], 'Axis (C2)', 'Axis', 'spine', 'irregular', 'c3', 'axis', 'c2', gender='m')
    for n in range(3, 8):
        add(f'c{n}', [f'Vertebra C{n}'], f'Cervical vertebra C{n}', f'Vertebra cervicalis {ROMAN[n]}' + (' (prominens)' if n == 7 else ''),
            'spine', 'irregular', f'c{n + 1}' if n < 7 else 't1', f'{ORD[n]} cervical vertebra', 'c7' if n == 7 else 'cervical')
    for n in range(1, 13):
        add(f't{n}', [f'Vertebra T{n}'], f'Thoracic vertebra T{n}', f'Vertebra thoracica {ROMAN[n]}', 'spine', 'irregular',
            f't{n + 1}' if n < 12 else 'l1', f'{ORD[n]} thoracic vertebra', 't1' if n == 1 else 't12' if n == 12 else 'thoracic')
    for n in range(1, 6):
        add(f'l{n}', [f'Vertebra L{n}'], f'Lumbar vertebra L{n}', f'Vertebra lumbalis {ROMAN[n]}', 'spine', 'irregular',
            f'l{n + 1}' if n < 5 else 'sacrum', f'{ORD[n]} lumbar vertebra', 'l5' if n == 5 else 'lumbar')
    add('sacrum', ['Sacrum'], 'Sacrum', 'Os sacrum', 'spine', 'irregular', None, 'sacrum', 'sacrum')
    add('coccyx', ['Coccyx'], 'Coccyx', 'Os coccygis', 'spine', 'irregular', 'sacrum', None, 'coccyx')

    # THORAX 25
    add('sternum', ['Manubrium of sternum', 'Body of sternum', 'Xiphoid process'], 'Sternum', 'Sternum', 'thorax', 'flat', 't6', None, 'sternum')
    for n in range(1, 13):
        fact = 'rib1' if n == 1 else 'rib-true' if n <= 7 else 'rib-false' if n <= 10 else 'rib-floating'
        pair(f'rib{n}', f'{ORD[n].capitalize()} rib', f'{ORD[n].capitalize()} rib', f'Costa {ROMAN[n]}', 'thorax', 'flat', f't{n}',
             f'{{side}} {ORD[n]} rib', fact, 'f')

    # UPPER LIMB per side: 2 + 3 + 27
    pair('clavicle', 'Clavicle', 'Clavicle', 'Clavicula', 'shoulder-{s}', 'long', 'sternum', '{side} clavicle', 'clavicle', 'f')
    pair('scapula', 'Scapula', 'Scapula', 'Scapula', 'shoulder-{s}', 'flat', 'clavicle-{s}', '{side} scapula', 'scapula', 'f')
    pair('humerus', 'Humerus', 'Humerus', 'Humerus', 'arm-{s}', 'long', 'scapula-{s}', '{side} humerus', 'humerus', 'm')
    pair('ulna', 'Ulna', 'Ulna', 'Ulna', 'arm-{s}', 'long', 'humerus-{s}', '{side} ulna', 'ulna', 'f')
    pair('radius', 'Radius', 'Radius', 'Radius', 'arm-{s}', 'long', 'humerus-{s}', '{side} radius', 'radius', 'm')
    carpals = [('scaphoid', 'Scaphoid bone', 'Scaphoid', 'Os scaphoideum', 'radius', '{side} scaphoid'),
               ('lunate', 'Lunate bone', 'Lunate', 'Os lunatum', 'radius', '{side} lunate'),
               ('triquetrum', 'Triquetrum bone', 'Triquetrum', 'Os triquetrum', 'lunate', '{side} triquetral'),
               ('pisiform', 'Pisiform bone', 'Pisiform', 'Os pisiforme', 'triquetrum', '{side} pisiform'),
               ('trapezium', 'Trapezium bone', 'Trapezium', 'Os trapezium', 'scaphoid', '{side} trapezium'),
               ('trapezoid', 'Trapezoid bone', 'Trapezoid', 'Os trapezoideum', 'scaphoid', '{side} trapezoid'),
               ('capitate', 'Capitate bone', 'Capitate', 'Os capitatum', 'lunate', '{side} capitate'),
               ('hamate', 'Hamate bone', 'Hamate', 'Os hamatum', 'triquetrum', '{side} hamate')]
    for cid, obj, name, lat, par, fma in carpals:
        pair(cid, obj, name, lat, 'hand-{s}', 'sesamoid' if cid == 'pisiform' else 'short', f'{par}-{{s}}', fma, cid)
    mc_parent = {1: 'trapezium', 2: 'trapezoid', 3: 'capitate', 4: 'hamate', 5: 'hamate'}
    fingers = {1: 'thumb', 2: 'index finger', 3: 'middle finger', 4: 'ring finger', 5: 'little finger'}
    fing_lat = {1: 'pollicis', 2: 'digiti II manus', 3: 'digiti III manus', 4: 'digiti IV manus', 5: 'digiti V manus'}
    for n in range(1, 6):
        pair(f'mc{n}', f'{ORD[n].capitalize()} metacarpal bone', f'{ORD[n].capitalize()} metacarpal', f'Os metacarpi {ROMAN[n]}',
             'hand-{s}', 'long', f'{mc_parent[n]}-{{s}}', f'{{side}} {ORD[n]} metacarpal bone', 'mc1' if n == 1 else 'mc')
    for n in range(1, 6):
        f = fingers[n]
        pair(f'pp{n}', f'Proximal phalanx of {ORD[n]} finger of hand', f'Proximal phalanx, {f}', f'Phalanx proximalis {fing_lat[n]}',
             'hand-{s}', 'long', f'mc{n}-{{s}}', f'proximal phalanx of {{side}} {f}', 'pp-thumb' if n == 1 else 'pp-hand', 'f', kind='pp-hand')
        if n > 1:
            pair(f'mp{n}', f'Middle phalanx of {ORD[n]} finger of hand', f'Middle phalanx, {f}', f'Phalanx media {fing_lat[n]}',
                 'hand-{s}', 'long', f'pp{n}-{{s}}', f'middle phalanx of {{side}} {f}', 'mp-hand', 'f')
        pair(f'dp{n}', f'Distal phalanx of {ORD[n]} finger of hand', f'Distal phalanx, {f}', f'Phalanx distalis {fing_lat[n]}',
             'hand-{s}', 'long', f'{"mp" if n > 1 else "pp"}{n}-{{s}}', f'distal phalanx of {{side}} {f}', 'dp-hand', 'f')

    # PELVIS 2
    pair('hip', 'Hip bone', 'Hip bone', 'Os coxae', 'pelvis', 'irregular', 'sacrum', '{side} hip bone', 'hip')
    # LOWER LIMB per side: 4 + 26
    pair('femur', 'Femur', 'Femur', 'Femur', 'leg-{s}', 'long', 'hip-{s}', '{side} femur', 'femur')
    pair('patella', 'Patella', 'Patella', 'Patella', 'leg-{s}', 'sesamoid', 'femur-{s}', '{side} patella', 'patella', 'f')
    pair('tibia', 'Tibia', 'Tibia', 'Tibia', 'leg-{s}', 'long', 'femur-{s}', '{side} tibia', 'tibia', 'f')
    pair('fibula', 'Fibula', 'Fibula', 'Fibula', 'leg-{s}', 'long', 'tibia-{s}', '{side} fibula', 'fibula', 'f')
    tarsals = [('talus', 'Talus', 'Talus', 'Talus', 'tibia', '{side} talus', 'm'),
               ('calcaneus', 'Calcaneus', 'Calcaneus', 'Calcaneus', 'talus', '{side} calcaneus', 'm'),
               ('navicular', 'Navicular bone', 'Navicular', 'Os naviculare', 'talus', 'navicular bone of {side} foot', 'n'),
               ('cuboid', 'Cuboid bone', 'Cuboid', 'Os cuboideum', 'calcaneus', '{side} cuboid bone', 'n'),
               ('cun1', 'Medial cuneiform bone', 'Medial cuneiform', 'Os cuneiforme mediale', 'navicular', '{side} medial cuneiform bone', 'n'),
               ('cun2', 'Intermediate cuneiform bone', 'Intermediate cuneiform', 'Os cuneiforme intermedium', 'navicular',
                '{side} intermediate cuneiform bone', 'n'),
               ('cun3', 'Lateral cuneiform bone', 'Lateral cuneiform', 'Os cuneiforme laterale', 'navicular', '{side} lateral cuneiform bone', 'n')]
    for tid, obj, name, lat, par, fma, g in tarsals:
        pair(tid, obj, name, lat, 'foot-{s}', 'short', f'{par}-{{s}}', fma, 'cuneiform' if tid.startswith('cun') else tid, g)
    mt_parent = {1: 'cun1', 2: 'cun2', 3: 'cun3', 4: 'cuboid', 5: 'cuboid'}
    toes = {1: 'big toe', 2: 'second toe', 3: 'third toe', 4: 'fourth toe', 5: 'little toe'}
    toe_lat = {1: 'hallucis', 2: 'digiti II pedis', 3: 'digiti III pedis', 4: 'digiti IV pedis', 5: 'digiti V pedis'}
    for n in range(1, 6):
        pair(f'mt{n}', f'{ORD[n].capitalize()} metatarsal bone', f'{ORD[n].capitalize()} metatarsal', f'Os metatarsi {ROMAN[n]}',
             'foot-{s}', 'long', f'{mt_parent[n]}-{{s}}', f'{{side}} {ORD[n]} metatarsal bone', 'mt1' if n == 1 else 'mt5' if n == 5 else 'mt')
    for n in range(1, 6):
        t = toes[n]
        pair(f'ppt{n}', f'Proximal phalanx of {ORD[n]} finger of foot', f'Proximal phalanx, {t}', f'Phalanx proximalis {toe_lat[n]}',
             'foot-{s}', 'long', f'mt{n}-{{s}}', f'proximal phalanx of {{side}} {t}', 'pp-foot', 'f')
        if n > 1:
            pair(f'mpt{n}', f'Middle phalanx of {ORD[n]} finger of foot', f'Middle phalanx, {t}', f'Phalanx media {toe_lat[n]}',
                 'foot-{s}', 'long', f'ppt{n}-{{s}}', f'middle phalanx of {{side}} {t}', 'mp-foot', 'f')
        pair(f'dpt{n}', f'Distal phalanx of {ORD[n]} finger of foot', f'Distal phalanx, {t}', f'Phalanx distalis {toe_lat[n]}',
             'foot-{s}', 'long', f'{"mpt" if n > 1 else "ppt"}{n}-{{s}}', f'distal phalanx of {{side}} {t}', 'dp-foot', 'f')

    # TEETH 28 (no third molars in the source), outside the 206 count
    teeth = [('i1', 'medial incisor', 'Central incisor', 'Dens incisivus medialis', 'central secondary incisor tooth'),
             ('i2', 'lateral incisor', 'Lateral incisor', 'Dens incisivus lateralis', 'lateral secondary incisor tooth'),
             ('c', 'canine', 'Canine', 'Dens caninus', 'secondary canine tooth'),
             ('pm1', 'first premolar', 'First premolar', 'Dens premolaris primus', 'first secondary premolar tooth'),
             ('pm2', 'second premolar', 'Second premolar', 'Dens premolaris secundus', 'second secondary premolar tooth'),
             ('m1', 'first molar tooth', 'First molar', 'Dens molaris primus', 'first secondary molar tooth'),
             ('m2', 'second molar tooth', 'Second molar', 'Dens molaris secundus', 'second secondary molar tooth')]
    for jaw, jawname, par in (('u', 'Upper', 'maxilla-{s}'), ('l', 'Lower', 'mandible')):
        for tid, obj, name, lat, fma in teeth:
            pair(f'{jaw}{tid}', f'{jawname} {obj}', f'{jawname} {name.lower()}', f'{lat} {"superior" if jaw == "u" else "inferior"}',
                 'teeth', 'tooth', par, f'{{side}} {jawname.lower()} {fma}' if tid != 'c' else f'{{side}} {jawname.lower()} secondary canine tooth',
                 'tooth', 'm', counted=False)
    # COSTAL CARTILAGE 20, outside the count, off by default
    for n in range(1, 11):
        pair(f'cc{n}', f'Costal cartilage of {ORD[n]} rib', f'Costal cartilage {ROMAN[n]}', f'Cartilago costalis {ROMAN[n]}', 'cartilage',
             'cartilage', f'rib{n}-{{s}}', f'{{side}} {ORD[n]} costal cartilage', 'cartilage', 'f', counted=False)
    return out


# ── source ──────────────────────────────────────────────────────────────────
def extract(blend, names):
    """World-space triangles for each object name: {name: (V float64 Nx3, F int Mx3)}."""
    import bpy
    bpy.ops.wm.open_mainfile(filepath=blend, load_ui=False)
    dg = bpy.context.evaluated_depsgraph_get()
    out = {}
    for nm in names:
        ob = bpy.data.objects.get(nm)
        if ob is None:
            raise SystemExit(f'missing object in blend: {nm}')
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        nv, nt = len(me.vertices), len(me.loop_triangles)
        co = np.empty(nv * 3, np.float64)
        me.vertices.foreach_get('co', co)
        tri = np.empty(nt * 3, np.int64)
        me.loop_triangles.foreach_get('vertices', tri)
        M = np.array(ob.matrix_world)
        V = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
        F = tri.reshape(-1, 3)
        if np.linalg.det(M[:3, :3]) < 0:
            F = F[:, ::-1].copy()
        ev.to_mesh_clear()
        out[nm] = (V, F)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return out


def to_page(V):
    """Blend frame (x left, y back, z up) to page frame (x left, y up, z front)."""
    return np.stack([V[:, 0], V[:, 2], -V[:, 1]], axis=1)


def weld(V, F, eps=1e-6):
    q = np.round(V / eps).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    F2 = inv.reshape(-1)[F]
    keep = (F2[:, 0] != F2[:, 1]) & (F2[:, 1] != F2[:, 2]) & (F2[:, 0] != F2[:, 2])
    return V[first], F2[keep]


def to_blender(V, F):
    import bpy
    me = bpy.data.meshes.new('tmp')
    me.vertices.add(len(V))
    me.vertices.foreach_set('co', V.astype(np.float32).ravel())
    me.loops.add(len(F) * 3)
    me.loops.foreach_set('vertex_index', F.astype(np.int32).ravel())
    me.polygons.add(len(F))
    me.polygons.foreach_set('loop_start', np.arange(0, len(F) * 3, 3, dtype=np.int32))
    me.update(calc_edges=True)
    ob = bpy.data.objects.new('tmp', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, me


def from_blender(ob, me):
    import bpy
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m2 = ev.to_mesh()
    m2.calc_loop_triangles()
    co = np.empty(len(m2.vertices) * 3, np.float64)
    m2.vertices.foreach_get('co', co)
    tri = np.empty(len(m2.loop_triangles) * 3, np.int64)
    m2.loop_triangles.foreach_get('vertices', tri)
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    V2, F2 = co.reshape(-1, 3), tri.reshape(-1, 3)
    return compact(V2, F2)


def decimate(V, F, target):
    """Blender collapse decimation to about `target` triangles."""
    if len(F) <= target * 1.05:
        return V, F
    ob, me = to_blender(V, F)
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = target / len(F)
    mod.use_collapse_triangulate = True
    return from_blender(ob, me)


def subdivide(V, F):
    """One Catmull-Clark level: a coarse small bone gets a round outline."""
    ob, me = to_blender(V, F)
    mod = ob.modifiers.new('sub', 'SUBSURF')
    mod.levels = 1
    mod.boundary_smooth = 'PRESERVE_CORNERS'
    return from_blender(ob, me)


def compact(V2, F2):
    used = np.unique(F2)
    remap = np.full(len(V2), -1, np.int64)
    remap[used] = np.arange(len(used))
    return V2[used], remap[F2]


def area(V, F):
    return 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1).sum()


def shade(V, F):
    """Area-weighted vertex normals and a cavity term in 0..1."""
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    ln = np.linalg.norm(N, axis=1)
    weak = ln < 1e-9 * max(1.0, float(np.median(ln)))
    if weak.any():  # faces that cancel out (a fold): point away from the centre
        N[weak] = V[weak] - V.mean(0)
        ln = np.linalg.norm(N, axis=1)
    N /= np.maximum(ln, 1e-12)[:, None]
    # neighbour mean through the edges
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    E = np.concatenate([E, E[:, ::-1]])
    nb = np.zeros_like(V)
    cnt = np.zeros(len(V))
    np.add.at(nb, E[:, 0], V[E[:, 1]])
    np.add.at(cnt, E[:, 0], 1)
    nb /= np.maximum(cnt, 1)[:, None]
    el = np.linalg.norm(V[E[:, 0]] - V[E[:, 1]], axis=1)
    elm = np.zeros(len(V))
    np.add.at(elm, E[:, 0], el)
    elm /= np.maximum(cnt, 1)
    c = np.einsum('ij,ij->i', nb - V, N) / np.maximum(elm, 1e-9)
    for _ in range(3):  # smooth over the 1-ring
        s = np.zeros(len(V))
        np.add.at(s, E[:, 0], c[E[:, 1]])
        c = 0.5 * c + 0.5 * s / np.maximum(cnt, 1)
    cav = np.clip(c * 3.0, 0, 1) ** 0.8
    return N, cav


def lay_pose(V):
    """Rotation that lays the bone flat: long axis to x, thin axis to y."""
    C = V - V.mean(0)
    w, U = np.linalg.eigh(C.T @ C)
    e3, e2, e1 = U[:, 0], U[:, 1], U[:, 2]
    R = np.stack([e1, e3, e2])
    if np.linalg.det(R) < 0:
        R[2] = -R[2]
    return R


def quat_from_matrix(R):
    t = np.trace(R)
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = [(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, 0.25 * s]
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = math.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        q = [0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s, (R[2, 1] - R[1, 2]) / s]
    elif R[1, 1] > R[2, 2]:
        s = math.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        q = [(R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s, (R[0, 2] - R[2, 0]) / s]
    else:
        s = math.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        q = [(R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s, (R[1, 0] - R[0, 1]) / s]
    q = np.array(q)
    return q / np.linalg.norm(q)


def relate(bones, meshes, by_id):
    """Articulations by proximity, and the joint point with the parent."""
    trees = {b['id']: cKDTree(meshes[b['id']][0]) for b in bones}
    boxes = {b['id']: (meshes[b['id']][0].min(0), meshes[b['id']][0].max(0)) for b in bones}
    TOL = 0.0045  # 4.5 mm: joint space plus the decimation error

    def closest(a, b):
        Va = meshes[a][0]
        d, j = trees[b].query(Va, k=1)
        i = int(np.argmin(d))
        return float(d[i]), (Va[i] + meshes[b][0][j[i]]) / 2

    def near_box(a, b, m):
        (a0, a1), (b0, b1) = boxes[a], boxes[b]
        return np.all(a0 - m <= b1) and np.all(b0 - m <= a1)

    ids = [b['id'] for b in bones]
    arts = {i: [] for i in ids}
    for x in range(len(ids)):
        for y in range(x + 1, len(ids)):
            a, b = ids[x], ids[y]
            ta, tb = by_id[a]['type'], by_id[b]['type']
            if ta == 'tooth' and tb == 'tooth':
                continue
            if (ta == 'cartilage') != (tb == 'cartilage') and 'tooth' in (ta, tb):
                continue
            if not near_box(a, b, TOL):
                continue
            d, _ = closest(a, b) if len(meshes[a][0]) < len(meshes[b][0]) else closest(b, a)
            if d < TOL:
                arts[a].append((d, b))
                arts[b].append((d, a))
    # curated joints the proximity test misses: a disc or a cartilage fills
    # the gap (TMJ, sternoclavicular, sternocostal through the cartilages)
    sides = lambda pairs: [(a.replace('{s}', s), b.replace('{s}', s)) for a, b in pairs for s in 'lr']
    curated = [('mandible', 'temporal-l'), ('mandible', 'temporal-r'), ('sternum', 'clavicle-l'), ('sternum', 'clavicle-r'),
               ('coccyx', 'sacrum')] + [('sternum', f'rib{n}-{s}') for n in range(1, 8) for s in 'lr'] + \
        sides([('radius-{s}', 'humerus-{s}'), ('lunate-{s}', 'radius-{s}')])
    for a, b in curated:
        if a in arts and b in arts:
            arts[a].append((TOL, b)); arts[b].append((TOL, a))
    # contacts that are proximity only, not joints
    not_joints = [('mandible', 'sphenoid')] + sides([
        ('lunate-{s}', 'ulna-{s}'), ('triquetrum-{s}', 'ulna-{s}'), ('triquetrum-{s}', 'mc5-{s}'), ('pisiform-{s}', 'hamate-{s}'),
        ('mc1-{s}', 'mc2-{s}'), ('talus-{s}', 'cuboid-{s}'), ('navicular-{s}', 'calcaneus-{s}'), ('cuboid-{s}', 'mt3-{s}'),
        ('rib1-{s}', 'c7')]) + [(f'scapula-{s}', f'rib{n}-{s}') for n in range(1, 13) for s in 'lr']
    for a, b in not_joints:
        if a not in arts or b not in arts:
            continue
        arts[a] = [x for x in arts[a] if x[1] != b]; arts[b] = [x for x in arts[b] if x[1] != a]
    soft = ('tooth', 'cartilage')
    for b in bones:
        own = by_id[b['id']]['type']
        seen, lst = set(), []
        for _, i in sorted(arts[b['id']]):
            if i in seen or (own not in soft and by_id[i]['type'] in soft):
                continue
            seen.add(i); lst.append(i)
        b['art'] = lst[:16]
        if b['parent']:
            d, p = closest(b['id'], b['parent'])
            b['joint'] = [round(float(v), 5) for v in p]
            b['jointGap'] = round(d * 1000, 2)
        else:
            b['joint'] = None


# ── pack ────────────────────────────────────────────────────────────────────
def pack(bones, meshes, outdir, groups):
    files = {}
    for g, _ in groups:
        files[g] = bytearray()

    def pad4(buf):
        while len(buf) % 4:
            buf.append(0)

    for b in bones:
        V, F, N, cav = meshes[b['id']]
        buf = files[b['file']]
        lo, hi = V.min(0), V.max(0)
        size = np.maximum(hi - lo, 1e-6)
        q = np.round((V - lo) / size * 65535).astype(np.uint16)
        n8 = np.clip(np.round(N * 127), -127, 127).astype(np.int8)
        c8 = np.clip(np.round(cav * 255), 0, 255).astype(np.uint8)
        idx = F.astype(np.uint16)
        off = {}
        pad4(buf); off['pos'] = len(buf); buf += q.tobytes()
        pad4(buf); off['nrm'] = len(buf); buf += n8.tobytes()
        pad4(buf); off['cav'] = len(buf); buf += c8.tobytes()
        pad4(buf); off['idx'] = len(buf); buf += idx.tobytes()
        b['off'] = off
        b['v'] = int(len(V))
        b['t'] = int(len(F))
        b['qmin'] = [round(float(x), 6) for x in lo]
        b['qsize'] = [round(float(x), 6) for x in size]
    out = []
    for g, label in groups:
        raw = bytes(files[g])
        if not raw:
            continue
        gz = gzip.compress(raw, compresslevel=9, mtime=0)
        name = f'{g}.bin.gz'
        with open(os.path.join(outdir, name), 'wb') as fh:
            fh.write(gz)
        out.append(dict(id=g, label=label, url='data/' + name, bytes=len(raw), gz=len(gz)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--blend', required=True)
    ap.add_argument('--bp3d', required=True, help='BodyParts3D isa_parts_list_e.txt (FMA ids)')
    ap.add_argument('--out', default=os.path.join(HERE, 'data'))
    ap.add_argument('--budget', type=int, default=420000, help='triangles for the bones and teeth')
    ap.add_argument('--ossicles', action='store_true', help='include the Z-Anatomy ossicles (licence not proven, see header)')
    a = ap.parse_args()
    t0 = time.time()
    os.makedirs(a.out, exist_ok=True)

    bones = catalogue(a.ossicles)
    by_id = {b['id']: b for b in bones}
    for b in bones:
        assert b['parent'] is None or b['parent'] in by_id, (b['id'], b['parent'])
    reg = {r[0]: r for r in REGIONS}
    for b in bones:
        b['group'] = reg[b['region']][2]
        b['file'] = b['group']

    # FMA ids from BodyParts3D, by English name; the rest are curated
    fma = {}
    with open(a.bp3d, encoding='utf-8') as fh:
        next(fh)
        for line in fh:
            cid, _, en = line.rstrip('\n').split('\t')
            fma[en.strip().lower()] = int(cid[3:])
    FMA_EXTRA = {'sternum': 7485, 'coccyx': 20229}
    for b in bones:
        b['fma'] = fma.get((b.pop('fmaName') or '').lower()) or FMA_EXTRA.get(b['id'])

    names = sorted({o for b in bones for o in b['objs']})
    print(f'[extract] {len(names)} objects from {os.path.basename(a.blend)}', flush=True)
    src = extract(a.blend, names)
    print(f'[extract] done in {time.time() - t0:.1f}s', flush=True)

    raw = {}
    for b in bones:
        Vs, Fs, base = [], [], 0
        for o in b['objs']:
            V, F = src[o]
            Vs.append(to_page(V)); Fs.append(F + base); base += len(V)
        V, F = weld(np.concatenate(Vs), np.concatenate(Fs))
        raw[b['id']] = (V, F)

    # global frame: feet on y = 0, x centred on the midline, z on the body box
    allV = np.concatenate([raw[b['id']][0] for b in bones if b['counted']])
    lo, hi = allV.min(0), allV.max(0)
    shift = np.array([0.0, -lo[1], -(lo[2] + hi[2]) / 2])
    raw = {k: (V + shift, F) for k, (V, F) in raw.items()}

    # budget: triangles grow with area^0.75, between a floor and a ceiling
    areas = {k: area(V, F) * 1e4 for k, (V, F) in raw.items()}  # cm^2
    main_ids = [b['id'] for b in bones if b['type'] != 'cartilage']

    def total(K):
        return sum(min(len(raw[i][1]), max(160, min(12000, K * areas[i] ** 0.75))) for i in main_ids)
    k0, k1 = 0.1, 500.0
    for _ in range(50):
        km = (k0 + k1) / 2
        k0, k1 = (km, k1) if total(km) < a.budget else (k0, km)
    K = k0
    print(f'[budget] K={K:.2f} -> {int(total(K))} triangles for {len(main_ids)} meshes', flush=True)

    meshes = {}
    mirrored = smoothed = 0
    SMOOTH_UNDER = 1600  # source triangles: coarser bones get one subdivision
    for b in bones:
        i = b['id']
        V, F = raw[i]
        tgt = int(max(160, min(12000, K * areas[i] ** 0.75)))
        if b['type'] == 'cartilage':
            tgt = int(max(120, min(1600, K * 0.6 * areas[i] ** 0.75)))
        if b['side'] == 'R':
            li = i[:-1] + 'l'
            VL, FL = raw[li]
            mir = VL * np.array([-1, 1, 1])
            if len(VL) == len(V) and np.abs(np.sort(mir, axis=0) - np.sort(V, axis=0)).max() < 5e-4:
                Vd, Fd = meshes[li][0] * np.array([-1, 1, 1]), meshes[li][1][:, ::-1].copy()
                mirrored += 1
                b['mirror'] = True
                N, cav = shade(Vd, Fd)
                meshes[i] = (Vd, Fd, N, cav)
                continue
        if b['type'] == 'tooth':
            tgt = min(tgt, 520)  # small, and mostly inside the jaw
        elif len(F) < SMOOTH_UNDER and b['type'] != 'cartilage':
            tgt = max(tgt, min(int(len(F) * 2.2), 3000))
            V, F = subdivide(V, F)
            smoothed += 1
        Vd, Fd = decimate(V, F, tgt)
        N, cav = shade(Vd, Fd)
        meshes[i] = (Vd, Fd, N, cav)
        assert len(Vd) < 65536, i
    print(f'[decimate] {sum(len(m[1]) for m in meshes.values())} triangles, {mirrored} right meshes mirrored from the left, '
          f'{smoothed} coarse meshes subdivided once',
          flush=True)

    # geometry facts per bone
    for b in bones:
        V = meshes[b['id']][0]
        lo, hi = V.min(0), V.max(0)
        c = (lo + hi) / 2
        b['c'] = [round(float(x), 5) for x in c]
        b['r'] = round(float(np.linalg.norm(V - c, axis=1).max()), 5)
        R = lay_pose(V)
        L = (V - c) @ R.T
        llo, lhi = L.min(0), L.max(0)
        b['len'] = round(float((lhi - llo)[0]) * 1000, 1)
        b['lay'] = dict(q=[round(float(x), 6) for x in quat_from_matrix(R)],
                        ext=[round(float(x), 5) for x in (lhi - llo)], c=[round(float(x), 5) for x in (lhi + llo) / 2])
        b['area'] = round(areas[b['id']], 2)
    relate(bones, {k: m for k, m in meshes.items()}, by_id)
    print(f'[relate] done in {time.time() - t0:.1f}s', flush=True)

    files = pack(bones, meshes, a.out, GROUPS)
    regions = []
    for rid, label, group, exp in REGIONS:
        n = sum(1 for b in bones if b['region'] == rid)
        if n == 0 and not exp:
            continue
        regions.append(dict(id=rid, label=label, group=group, count=n, expected=exp))
    for i, b in enumerate(bones):
        b['i'] = i
        del b['objs']
    keys = ['i', 'id', 'name', 'latin', 'region', 'group', 'side', 'type', 'kind', 'fma', 'counted', 'mirror', 'parent', 'art', 'joint', 'jointGap',
            'fact', 'c', 'r', 'len', 'area', 'lay', 'file', 'off', 'v', 't', 'qmin', 'qsize']
    manifest = dict(
        version=1,
        units='m', up='y', front='+z',
        source=dict(
            meshes='Z-Anatomy, the libre 3D atlas of anatomy (Gauthier Kervyn, Marcin Zielinski), CC BY-SA 4.0',
            meshesUrl='https://github.com/Z-Anatomy/Models-of-human-anatomy',
            origin='BodyParts3D, (c) The Database Center for Life Science (DBCLS), CC BY 4.0 (earlier releases CC BY-SA 2.1 JP)',
            originUrl='https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html',
            fma='FMA ids from BodyParts3D isa_parts_list_e.txt',
            licence='CC BY-SA 4.0', licenceUrl='https://creativecommons.org/licenses/by-sa/4.0/',
            ossicles=bool(a.ossicles)),
        groups=[dict(id=g, label=l) for g, l in GROUPS],
        regions=regions,
        files=files,
        bones=[{k: b.get(k) for k in keys} for b in bones],
    )
    with open(os.path.join(a.out, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, separators=(',', ':'), ensure_ascii=False)
    tot = sum(f['gz'] for f in files)
    print('[pack] ' + '  '.join(f"{f['id']} {f['gz'] / 1024:.0f}k" for f in files))
    print(f'[pack] total {tot / 1048576:.2f} MB gz, manifest {os.path.getsize(os.path.join(a.out, "manifest.json")) / 1024:.0f} KB')
    print('[count] ' + '  '.join(f"{r['label']} {r['count']}" for r in regions))
    print(f'[count] counted bones {sum(1 for b in bones if b["counted"])} of 206; done in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
