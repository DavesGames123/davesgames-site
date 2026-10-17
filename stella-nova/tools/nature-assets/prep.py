# Blender side of prep.mjs: turn FBX, OBJ or .blend sources into one
# glTF (.gltf + .bin, no images) with one top level node per variant.
#
# Run (prep.mjs does this):
#   Blender -b --factory-startup --disable-autoexec --python prep.py -- job.json
# job = { out: "/abs/x.gltf",
#         inputs: [ { file, name, scale, objects?: [names] } ],
#         images: [ [src (tga, tif, ...), dst png], ... ] }
# Each input becomes one object called `name`: the meshes of the file
# (or only `objects` of a .blend) are joined, the object transforms and
# `scale` are applied, and the base sits at the origin. Material names
# stay as in the source; prep.mjs adds the textures to the glTF.
# Images in `images` are saved as PNG (alpha kept) for sharp, which
# cannot read TGA.
import bpy, sys, json, os

job = json.load(open(sys.argv[sys.argv.index('--') + 1]))

for src, dst in job.get('images', []):
    if os.path.exists(dst):
        continue
    img = bpy.data.images.load(src)
    img.pixels[0]  # force the pixel load
    st = bpy.context.scene.render.image_settings
    st.file_format = 'PNG'; st.color_mode = 'RGBA' if img.channels == 4 else 'RGB'; st.color_depth = '8'
    bpy.context.scene.view_settings.view_transform = 'Standard'
    img.save_render(dst)
    bpy.data.images.remove(img)

if not job.get('inputs'):
    raise SystemExit(0)

bpy.ops.wm.read_factory_settings(use_empty=True)
made = []
for k, inp in enumerate(job['inputs']):
    before = set(bpy.data.objects)
    f = inp['file']
    ext = os.path.splitext(f)[1].lower()
    if ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=f)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=f)
    elif ext == '.blend':
        with bpy.data.libraries.load(f, link=False) as (src, dst):
            dst.objects = [n for n in src.objects if n in inp['objects']]
        for o in dst.objects:
            bpy.context.scene.collection.objects.link(o)
    else:
        raise SystemExit('prep.py: unknown input ' + f)
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    if not new:
        raise SystemExit('prep.py: no meshes in ' + f)
    bpy.ops.object.select_all(action='DESELECT')
    for o in new:
        o.select_set(True)
        if o.parent:
            mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    # Faces of dropped materials (roots under the ground plane) go first.
    drop = set(inp.get('drop', []))
    if drop:
        import bmesh
        for o in new:
            names = [m.name.split('.')[0] if m else '' for m in o.data.materials]
            bm = bmesh.new(); bm.from_mesh(o.data)
            dead = [f for f in bm.faces if f.material_index < len(names) and names[f.material_index] in drop]
            bmesh.ops.delete(bm, geom=dead, context='FACES')
            bm.to_mesh(o.data); bm.free()
    bpy.context.view_layer.objects.active = new[0]
    # A .blend object can sit far from the origin: move it back first.
    if ext == '.blend':
        for o in new:
            o.location = (0, 0, 0)
    if len(new) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    # OBJ files with no .mtl: name the material after the variant, so the
    # texture rules of the catalog can find it.
    if not o.data.materials:
        o.data.materials.append(bpy.data.materials.new(inp['name']))
    for e in [x for x in bpy.data.objects if x not in before and x != o]:
        bpy.data.objects.remove(e, do_unlink=True)
    s = inp.get('scale', 1.0)
    o.scale = (o.scale[0] * s, o.scale[1] * s, o.scale[2] * s)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Base centre to the origin (Blender is z up; glTF export makes it y up).
    xs = [v.co.x for v in o.data.vertices]; ys = [v.co.y for v in o.data.vertices]; zs = [v.co.z for v in o.data.vertices]
    off = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs))
    for v in o.data.vertices:
        v.co.x -= off[0]; v.co.y -= off[1]; v.co.z -= off[2]
    # Variants side by side, so a viewer of the raw glTF can tell them apart.
    o.location = (k * 30.0, 0, 0)
    o.name = inp['name']
    o.data.name = inp['name']
    made.append(o)
    print('prep: %s tris %d h %.2f m' % (inp['name'], sum(len(p.vertices) - 2 for p in o.data.polygons), max(zs) - min(zs)))

bpy.ops.object.select_all(action='DESELECT')
for o in made:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=job['out'], export_format='GLTF_SEPARATE', use_selection=True,
                          export_yup=True, export_apply=True, export_image_format='NONE',
                          export_materials='EXPORT', export_texcoords=True, export_normals=True,
                          export_tangents=False, export_animations=False, export_skins=False,
                          export_morph=False, export_cameras=False, export_lights=False)
print('prep: wrote', job['out'])
