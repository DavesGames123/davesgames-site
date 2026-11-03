# Articraft Playground: credits and licences

## Objects: Articraft dataset (CC BY 4.0)

Every object in `data/objects/` comes from a record of the Articraft dataset:

    Articraft Data, Matt Zhou et al., licensed under CC BY 4.0.
    https://github.com/mattzh72/articraft-data

- Licence: Creative Commons Attribution 4.0 International,
  https://creativecommons.org/licenses/by/4.0/. The licence text is the
  `LICENSE` file of the dataset repository.
- Source commit: `677ca9722427dce500873730255874c8c3f07eb2` (branch main).
- Paper: Matt Zhou, Ruining Li, Xiaoyang Lyu, Zhaomou Song, Zhening Huang,
  Chuanxia Zheng, Christian Rupprecht, Andrea Vedaldi, Shangzhe Wu.
  "Articraft: An Agentic System for Scalable Articulated 3D Asset
  Generation", arXiv:2605.15187, 2026. Project page:
  https://articraft3d.github.io/
- Each record is a generated `model.py`. The table below gives the record,
  the revision, the author field of the record and a link to the record
  folder. `data/manifest.json` keeps the full prompt of each record,
  verbatim.

### Changes that we made (CC BY 4.0, section 3(a)(1)(B))

1. We ran each `model.py` with the Articraft harness (below), offline, to
   get a URDF file and OBJ meshes.
2. `tools/urdf2mjcf.mjs` (our code) changed the URDF into MuJoCo MJCF:
   fixed joints are merged, each moving joint has a position actuator, the
   object is moved so that it stands on z = 0, and a link with no inertial
   gets the mass of its mesh volume (convex hull for an open mesh) at
   350 kg/m^3, in the range 0.02 to 2000 kg.
3. `tools/urdf2mjcf.mjs` simplified the meshes with our own quadric edge
   collapse and wrote them as binary STL.
4. The titles are our own words. The dataset category is in the table.

We do not ship records from the Military & Defense group, or records whose
title or prompt names a brand or a real product (`tools/select.py`).

## Tools that we used and do not ship

| What | Source | Licence | Use |
|---|---|---|---|
| Articraft harness | https://github.com/mattzh72/articraft, commit `959f1455091fc8f86a489ee8cab38f686916099f` | Apache-2.0 | compiles `model.py` to URDF + OBJ, offline, in a sandbox (`tools/compile.sh`). No harness code is in this repository. |
| CadQuery 2.7.0 | https://github.com/CadQuery/cadquery | Apache-2.0 | used by the harness to make the meshes |

## Engine

MuJoCo 3.15.0 WASM, vendored at `stella-nova/vendor/mujoco@3.15.0/`
(Apache-2.0, copyright Google DeepMind). The page imports it through
`pages/mujoco-lab/core/engine.js`.

## Per-object credits

66 objects. Each link opens the record folder on GitHub.

| Title (ours) | Group | Dataset category | Record | Revision | Author | Licence |
|---|---|---|---|---|---|---|
| Six-axis robot arm | Robotic Arms & Manipulators | Robotic Arms | [rec_robotic_arms_889477f5978f4a08a87bb80c115416f1](https://github.com/mattzh72/articraft-data/tree/main/records/rec_robotic_arms_889477f5978f4a08a87bb80c115416f1) | rev_000001 | RuiningLi | CC BY 4.0 |
| Five-finger robot hand | Robotic Arms & Manipulators | Palm with multiple uncoupled finger chains | [rec_palm_with_multiple_uncoupled_finger_chains_d2d331a636254040a5ceb7281d693093](https://github.com/mattzh72/articraft-data/tree/main/records/rec_palm_with_multiple_uncoupled_finger_chains_d2d331a636254040a5ceb7281d693093) | rev_000001 | mattzh72 | CC BY 4.0 |
| Hanging cantilever arm | Robotic Arms & Manipulators | Cantilever articulated arm | [rec_cantilever_articulated_arm_482bb4bc30fc4ab9a905d6a030180276](https://github.com/mattzh72/articraft-data/tree/main/records/rec_cantilever_articulated_arm_482bb4bc30fc4ab9a905d6a030180276) | rev_000001 | mattzh72 | CC BY 4.0 |
| Four-link fold-out arm | Robotic Arms & Manipulators | Multi-segment fold-out arm | [rec_multisegment_foldout_arm_6a78b73d29574f53895ef335c67711ac](https://github.com/mattzh72/articraft-data/tree/main/records/rec_multisegment_foldout_arm_6a78b73d29574f53895ef335c67711ac) | rev_000001 | mattzh72 | CC BY 4.0 |
| Rail carriage with spindle | Robotic Arms & Manipulators | Linear carriage with independent rotary end-effector | [rec_linear_carriage_with_independent_rotary_endeffector_e8c01cabfa634adf98a52fcc229c3343](https://github.com/mattzh72/articraft-data/tree/main/records/rec_linear_carriage_with_independent_rotary_endeffector_e8c01cabfa634adf98a52fcc229c3343) | rev_000001 | mattzh72 | CC BY 4.0 |
| Vertical slide with hinged bracket | Robotic Arms & Manipulators | Vertical slide with wrist hinge | [rec_vertical_slide_with_wrist_hinge_0ccb9ada99e34a1fa99e57cd8b1db653](https://github.com/mattzh72/articraft-data/tree/main/records/rec_vertical_slide_with_wrist_hinge_0ccb9ada99e34a1fa99e57cd8b1db653) | rev_000001 | mattzh72 | CC BY 4.0 |
| Radial beam with carriage | Robotic Arms & Manipulators | Radial arm with sliding carriage | [rec_radial_arm_with_sliding_carriage_f3c5aa592e5e45258283f863fe6d11ae](https://github.com/mattzh72/articraft-data/tree/main/records/rec_radial_arm_with_sliding_carriage_f3c5aa592e5e45258283f863fe6d11ae) | rev_000001 | RuiningLi | CC BY 4.0 |
| Tower arm with wrist | Robotic Arms & Manipulators | Shoulder-elbow-wrist arm | [rec_shoulderelbowwrist_arm_5bc8a524280e443f95a80c23759ed389](https://github.com/mattzh72/articraft-data/tree/main/records/rec_shoulderelbowwrist_arm_5bc8a524280e443f95a80c23759ed389) | rev_000001 | mattzh72 | CC BY 4.0 |
| Trunnion elbow arm | Robotic Arms & Manipulators | Serial elbow arm | [rec_serial_elbow_arm_6b166b55fd0c438fb80b1422f9f92539](https://github.com/mattzh72/articraft-data/tree/main/records/rec_serial_elbow_arm_6b166b55fd0c438fb80b1422f9f92539) | rev_000001 | mattzh72 | CC BY 4.0 |
| Hip-knee-ankle robot leg | Robotic Arms & Manipulators | Robotic leg | [rec_robotic_leg_da8e46698ccd44b39ca4be0beb45e907](https://github.com/mattzh72/articraft-data/tree/main/records/rec_robotic_leg_da8e46698ccd44b39ca4be0beb45e907) | rev_000001 | mattzh72 | CC BY 4.0 |
| Twin-jaw slide gripper | Robotic Arms & Manipulators | Opposed twin-slide gripper | [rec_opposed_twinslide_gripper_189a0f981f8846e982edadfa262c3967](https://github.com/mattzh72/articraft-data/tree/main/records/rec_opposed_twinslide_gripper_189a0f981f8846e982edadfa262c3967) | rev_000001 | RuiningLi | CC BY 4.0 |
| Turntable with lift head | Robotic Arms & Manipulators | Rotary base with vertical slide | [rec_rotary_base_with_vertical_slide_f72fad37371b4949a8d8abccc4265fe1](https://github.com/mattzh72/articraft-data/tree/main/records/rec_rotary_base_with_vertical_slide_f72fad37371b4949a8d8abccc4265fe1) | rev_000001 | mattzh72 | CC BY 4.0 |
| Hanging slide with two-link arm | Kinematic Chains | Prismatic-revolute-revolute chain | [rec_prismaticrevoluterevolute_chain_37dc7445ab6e4467a42b5d7b8d318b86](https://github.com/mattzh72/articraft-data/tree/main/records/rec_prismaticrevoluterevolute_chain_37dc7445ab6e4467a42b5d7b8d318b86) | rev_000001 | mattzh72 | CC BY 4.0 |
| Folding inspection boom | Kinematic Chains | Revolute-prismatic-revolute chain | [rec_revoluteprismaticrevolute_chain_f633f192481243d1af9fa84889f8ddf7](https://github.com/mattzh72/articraft-data/tree/main/records/rec_revoluteprismaticrevolute_chain_f633f192481243d1af9fa84889f8ddf7) | rev_000001 | RuiningLi | CC BY 4.0 |
| Two-finger palm | Kinematic Chains | Dual independent finger chains | [rec_dual_independent_finger_chains_b45f53ef637e44e7b6055096f5436a6a](https://github.com/mattzh72/articraft-data/tree/main/records/rec_dual_independent_finger_chains_b45f53ef637e44e7b6055096f5436a6a) | rev_000001 | mattzh72 | CC BY 4.0 |
| Four-joint link chain | Kinematic Chains | Four-joint revolute chain | [rec_fourjoint_revolute_chain_327b4927be2a4de2977623a6deb6137d](https://github.com/mattzh72/articraft-data/tree/main/records/rec_fourjoint_revolute_chain_327b4927be2a4de2977623a6deb6137d) | rev_000001 | mattzh72 | CC BY 4.0 |
| Two-joint link chain | Kinematic Chains | Two-joint revolute chain | [rec_twojoint_revolute_chain_9c56420090b044cd9234210681a4e1a5](https://github.com/mattzh72/articraft-data/tree/main/records/rec_twojoint_revolute_chain_9c56420090b044cd9234210681a4e1a5) | rev_000001 | mattzh72 | CC BY 4.0 |
| XYZ bench stage | Linear Stages & Gantries | XYZ Cartesian stage | [rec_xyz_cartesian_stage_a186865081b54986a58c785b0970c07b](https://github.com/mattzh72/articraft-data/tree/main/records/rec_xyz_cartesian_stage_a186865081b54986a58c785b0970c07b) | rev_000001 | mattzh72 | CC BY 4.0 |
| XY machine table | Linear Stages & Gantries | Orthogonal XY stage | [rec_orthogonal_xy_stage_6fbd80ab6518492b8d978a68b347a8fc](https://github.com/mattzh72/articraft-data/tree/main/records/rec_orthogonal_xy_stage_6fbd80ab6518492b8d978a68b347a8fc) | rev_000001 | mattzh72 | CC BY 4.0 |
| Portal gantry with tool slide | Linear Stages & Gantries | Portal gantry with vertical slide | [rec_portal_gantry_with_vertical_slide_84ca712fa4694ebb8ec1a3a1d796df6d](https://github.com/mattzh72/articraft-data/tree/main/records/rec_portal_gantry_with_vertical_slide_84ca712fa4694ebb8ec1a3a1d796df6d) | rev_000001 | mattzh72 | CC BY 4.0 |
| Wall-backed YZ stage | Linear Stages & Gantries | Orthogonal YZ stage | [rec_orthogonal_yz_stage_398ba8dc772041a491b4d4033bfa7715](https://github.com/mattzh72/articraft-data/tree/main/records/rec_orthogonal_yz_stage_398ba8dc772041a491b4d4033bfa7715) | rev_000001 | mattzh72 | CC BY 4.0 |
| Telescoping service boom | Linear Stages & Gantries | Telescoping boom | [rec_telescoping_boom_f858a0c9e6564485836ff2b798c5e74d](https://github.com/mattzh72/articraft-data/tree/main/records/rec_telescoping_boom_f858a0c9e6564485836ff2b798c5e74d) | rev_000001 | mattzh72 | CC BY 4.0 |
| Three-box telescoping slide | Linear Stages & Gantries | Three-stage telescoping slide | [rec_threestage_telescoping_slide_25c63d480dff4020bd83237d88461627](https://github.com/mattzh72/articraft-data/tree/main/records/rec_threestage_telescoping_slide_25c63d480dff4020bd83237d88461627) | rev_000001 | mattzh72 | CC BY 4.0 |
| Hanging three-axis wrist | Primitive Joints & Modules | Yaw-pitch-roll wrist | [rec_yawpitchroll_wrist_aefd600724ec4de9bfb029c97df9af74](https://github.com/mattzh72/articraft-data/tree/main/records/rec_yawpitchroll_wrist_aefd600724ec4de9bfb029c97df9af74) | rev_000001 | mattzh72 | CC BY 4.0 |
| Yaw rotary module | Primitive Joints & Modules | Single yaw axis module | [rec_single_yaw_axis_module_c3c23bea19ce4161af0d19f768dee829](https://github.com/mattzh72/articraft-data/tree/main/records/rec_single_yaw_axis_module_c3c23bea19ce4161af0d19f768dee829) | rev_000001 | mattzh72 | CC BY 4.0 |
| Shaft on two bearing blocks | Primitive Joints & Modules | Single continuous rotary shaft | [rec_single_continuous_rotary_shaft_f1c4a013658c40268bf0d8e5b521429b](https://github.com/mattzh72/articraft-data/tree/main/records/rec_single_continuous_rotary_shaft_f1c4a013658c40268bf0d8e5b521429b) | rev_000001 | RuiningLi | CC BY 4.0 |
| Heavy bracket hinge | Primitive Joints & Modules | Single revolute hinge | [rec_single_revolute_hinge_d4bb37b28179466396216af38e3a323f](https://github.com/mattzh72/articraft-data/tree/main/records/rec_single_revolute_hinge_d4bb37b28179466396216af38e3a323f) | rev_000001 | mattzh72 | CC BY 4.0 |
| Clamp-on task lamp | Mounts & Positioning | Articulated task lamp | [rec_articulated_task_lamp_40a6b812a19a487e857babea0348cfe7](https://github.com/mattzh72/articraft-data/tree/main/records/rec_articulated_task_lamp_40a6b812a19a487e857babea0348cfe7) | rev_000001 | Zhaomou Song | CC BY 4.0 |
| Folding wall mount for a screen | Mounts & Positioning | TV wall mount | [rec_tv_wall_mount_9f6dc3a99dac4ea491f35c1664d440f6](https://github.com/mattzh72/articraft-data/tree/main/records/rec_tv_wall_mount_9f6dc3a99dac4ea491f35c1664d440f6) | rev_000001 | mattzh72 | CC BY 4.0 |
| Compact monitor arm | Mounts & Positioning | Monitor mount | [rec_monitor_mount_ee2f63ac8a9844e08b148532730fbe48](https://github.com/mattzh72/articraft-data/tree/main/records/rec_monitor_mount_ee2f63ac8a9844e08b148532730fbe48) | rev_000001 | mattzh72 | CC BY 4.0 |
| Pole camera with pan and tilt | Mounts & Positioning | CCTV mast with pan-tilt camera head | [rec_cctv_mast_with_pantilt_camera_head_93c3153a76bb4780a51a0fc40c883bdb](https://github.com/mattzh72/articraft-data/tree/main/records/rec_cctv_mast_with_pantilt_camera_head_93c3153a76bb4780a51a0fc40c883bdb) | rev_000001 | Zhaomou Song | CC BY 4.0 |
| Telescoping floodlight mast | Mounts & Positioning | Floodlight mast with tilt head | [rec_floodlight_mast_with_tilt_head_5602f7ba2b334892b2535918bfd2c88b](https://github.com/mattzh72/articraft-data/tree/main/records/rec_floodlight_mast_with_tilt_head_5602f7ba2b334892b2535918bfd2c88b) | rev_000001 | mattzh72 | CC BY 4.0 |
| Multimeter with tilt stand | Tools & Workshop | Digital multimeter with tilt stand and rotary selector | [rec_digital_multimeter_with_tilt_stand_and_rotary_selector_2ba3e131d0f84e2aa8cff3f96a2d40d1](https://github.com/mattzh72/articraft-data/tree/main/records/rec_digital_multimeter_with_tilt_stand_and_rotary_selector_2ba3e131d0f84e2aa8cff3f96a2d40d1) | rev_000001 | RuiningLi | CC BY 4.0 |
| Crank pencil sharpener | Tools & Workshop | Desktop pencil sharpener with hand crank and drawer | [rec_desktop_pencil_sharpener_with_hand_crank_and_drawer_72d62640f651450abba6dda3c919bbfd](https://github.com/mattzh72/articraft-data/tree/main/records/rec_desktop_pencil_sharpener_with_hand_crank_and_drawer_72d62640f651450abba6dda3c919bbfd) | rev_000001 | mattzh72 | CC BY 4.0 |
| Paper shredder | Tools & Workshop | Paper shredder with pullout bin | [rec_paper_shredder_with_pullout_bin_257c3a6bda134b71a21b4f3fdebb6e88](https://github.com/mattzh72/articraft-data/tree/main/records/rec_paper_shredder_with_pullout_bin_257c3a6bda134b71a21b4f3fdebb6e88) | rev_000001 | RuiningLi | CC BY 4.0 |
| Clamp meter | Tools & Workshop | Clamp meter with hinged jaw and rotary selector | [rec_clamp_meter_with_hinged_jaw_and_rotary_selector_0a51248ffdf64581ae824f48a1501ef3](https://github.com/mattzh72/articraft-data/tree/main/records/rec_clamp_meter_with_hinged_jaw_and_rotary_selector_0a51248ffdf64581ae824f48a1501ef3) | rev_000001 | RuiningLi | CC BY 4.0 |
| Rolling toolbox | Tools & Workshop | Rolling toolbox with telescoping handle | [rec_rolling_toolbox_with_telescoping_handle_4d03191d2c76437f8bff47e8c3c3f6b1](https://github.com/mattzh72/articraft-data/tree/main/records/rec_rolling_toolbox_with_telescoping_handle_4d03191d2c76437f8bff47e8c3c3f6b1) | rev_000001 | mattzh72 | CC BY 4.0 |
| Juicer with plunger | Household Appliances | Centrifugal juicer with articulated components | [rec_centrifugal_juicer_with_articulated_components_7c6f5b279ac5419095505f5d360a141d](https://github.com/mattzh72/articraft-data/tree/main/records/rec_centrifugal_juicer_with_articulated_components_7c6f5b279ac5419095505f5d360a141d) | rev_000001 | mattzh72 | CC BY 4.0 |
| Countertop microwave | Household Appliances | Microwave oven | [rec_microwave_oven_1eefd68eae054d378225ad626c3374ef](https://github.com/mattzh72/articraft-data/tree/main/records/rec_microwave_oven_1eefd68eae054d378225ad626c3374ef) | rev_000001 | mattzh72 | CC BY 4.0 |
| Tower fan | Household Appliances | Tower fan with rotary controls | [rec_tower_fan_with_rotary_controls_9829351aafdb48bf84198895fefa69e6](https://github.com/mattzh72/articraft-data/tree/main/records/rec_tower_fan_with_rotary_controls_9829351aafdb48bf84198895fefa69e6) | rev_000001 | RuiningLi | CC BY 4.0 |
| Compact clothes dryer | Household Appliances | Front-load dryer | [rec_frontload_dryer_2aa487e0070b4132bdce1eaab09647b0](https://github.com/mattzh72/articraft-data/tree/main/records/rec_frontload_dryer_2aa487e0070b4132bdce1eaab09647b0) | rev_000001 | Zhaomou Song | CC BY 4.0 |
| Twin-tub washer | Household Appliances | Front-load washing machine | [rec_frontload_washing_machine_f25422568bc445c696a40d25832b4d07](https://github.com/mattzh72/articraft-data/tree/main/records/rec_frontload_washing_machine_f25422568bc445c696a40d25832b4d07) | rev_000001 | Zhaomou Song | CC BY 4.0 |
| Retro stand mixer | Household Appliances | Stand Mixer | [rec_stand_mixer_e87679fb832549fea06e97ed878f4300](https://github.com/mattzh72/articraft-data/tree/main/records/rec_stand_mixer_e87679fb832549fea06e97ed878f4300) | rev_000001 | mattzh72 | CC BY 4.0 |
| Sketch-box easel | Furniture & Storage | Easel | [rec_easel_df2ad7ec92e94cc4a2566526ad7162a1](https://github.com/mattzh72/articraft-data/tree/main/records/rec_easel_df2ad7ec92e94cc4a2566526ad7162a1) | rev_000001 | mattzh72 | CC BY 4.0 |
| Two-tier turntable tray | Furniture & Storage | Lazy Susan | [rec_lazy_susan_58dd9952bab54662b5e964ab70b82693](https://github.com/mattzh72/articraft-data/tree/main/records/rec_lazy_susan_58dd9952bab54662b5e964ab70b82693) | rev_000001 | mattzh72 | CC BY 4.0 |
| Overbed table | Furniture & Storage | Overbed table | [rec_overbed_table_5f76668df014481492342e4a62d16a62](https://github.com/mattzh72/articraft-data/tree/main/records/rec_overbed_table_5f76668df014481492342e4a62d16a62) | rev_000001 | RuiningLi | CC BY 4.0 |
| Two-door pantry cabinet | Furniture & Storage | Hinged-door cabinet | [rec_hingeddoor_cabinet_976b1a62a32e48b48ea77d7fcb17a6eb](https://github.com/mattzh72/articraft-data/tree/main/records/rec_hingeddoor_cabinet_976b1a62a32e48b48ea77d7fcb17a6eb) | rev_000001 | mattzh72 | CC BY 4.0 |
| Camera flash | Electronics & Optics | Camera flash | [rec_camera_flash_5ae8f5e444c24636ad4aa9e42b331fa3](https://github.com/mattzh72/articraft-data/tree/main/records/rec_camera_flash_5ae8f5e444c24636ad4aa9e42b331fa3) | rev_000001 | mattzh72 | CC BY 4.0 |
| Camcorder with flip-out screen | Electronics & Optics | Camcorder with flip-out screen | [rec_camcorder_with_flipout_screen_acb9eb4f13824629829be7540a8372e9](https://github.com/mattzh72/articraft-data/tree/main/records/rec_camcorder_with_flipout_screen_acb9eb4f13824629829be7540a8372e9) | rev_000001 | mattzh72 | CC BY 4.0 |
| Folding headphones | Electronics & Optics | Over-ear headphones with folding earcups | [rec_overear_headphones_with_folding_earcups_f5e1c285152947658fae734893cf3d58](https://github.com/mattzh72/articraft-data/tree/main/records/rec_overear_headphones_with_folding_earcups_f5e1c285152947658fae734893cf3d58) | rev_000001 | RuiningLi | CC BY 4.0 |
| Printer with scanner lid | Electronics & Optics | All-in-one printer with scanner lid and paper tray | [rec_all_in_one_printer_with_scanner_lid_and_paper_tray_2fa487f194524ba7b35fc345b2252469](https://github.com/mattzh72/articraft-data/tree/main/records/rec_all_in_one_printer_with_scanner_lid_and_paper_tray_2fa487f194524ba7b35fc345b2252469) | rev_000001 | RuiningLi | CC BY 4.0 |
| Skateboard | Vehicles & Mobility | Skateboard | [rec_skateboard_040c2a68fd204e0198f3ed615cb4dd37](https://github.com/mattzh72/articraft-data/tree/main/records/rec_skateboard_040c2a68fd204e0198f3ed615cb4dd37) | rev_000001 | shawlyu | CC BY 4.0 |
| Bicycle crankset | Vehicles & Mobility | Bicycle crankset and pedal assembly | [rec_bicycle_crankset_and_pedal_assembly_9304867f712844ec9eb912f655084898](https://github.com/mattzh72/articraft-data/tree/main/records/rec_bicycle_crankset_and_pedal_assembly_9304867f712844ec9eb912f655084898) | rev_000001 | mattzh72 | CC BY 4.0 |
| Utility helicopter | Vehicles & Mobility | Single-rotor helicopter | [rec_single_rotor_helicopter_39863ea3a843412f8349168b699859ce](https://github.com/mattzh72/articraft-data/tree/main/records/rec_single_rotor_helicopter_39863ea3a843412f8349168b699859ce) | rev_000001 | RuiningLi | CC BY 4.0 |
| Stair-climbing hand truck | Vehicles & Mobility | Hand truck dolly | [rec_hand_truck_dolly_8406519e6f144bdeb2105a14bf92ad5c](https://github.com/mattzh72/articraft-data/tree/main/records/rec_hand_truck_dolly_8406519e6f144bdeb2105a14bf92ad5c) | rev_000001 | RuiningLi | CC BY 4.0 |
| Farm swing gate | Doors, Gates & Access | Barrier gate | [rec_barrier_gate_6914569f72e1432d9bbe3d43ca86c6f0](https://github.com/mattzh72/articraft-data/tree/main/records/rec_barrier_gate_6914569f72e1432d9bbe3d43ca86c6f0) | rev_000001 | mattzh72 | CC BY 4.0 |
| Wall safe | Doors, Gates & Access | Wall Safe With Hinged Door And Dial | [rec_wall_safe_with_hinged_door_and_dial_3e77e640b3264c499a1b3d72c33be67d](https://github.com/mattzh72/articraft-data/tree/main/records/rec_wall_safe_with_hinged_door_and_dial_3e77e640b3264c499a1b3d72c33be67d) | rev_000001 | RuiningLi | CC BY 4.0 |
| Rising bollard | Doors, Gates & Access | Retractable bollard | [rec_retractable_bollard_6767b692a3f241d09a8673364b27bb4f](https://github.com/mattzh72/articraft-data/tree/main/records/rec_retractable_bollard_6767b692a3f241d09a8673364b27bb4f) | rev_000001 | mattzh72 | CC BY 4.0 |
| A-frame step ladder | Buildings & Infrastructure | Simple A-frame step ladder | [rec_simple_aframe_step_ladder_0ccc2f16dacb4d70bc19939a2140441e](https://github.com/mattzh72/articraft-data/tree/main/records/rec_simple_aframe_step_ladder_0ccc2f16dacb4d70bc19939a2140441e) | rev_000001 | shawlyu | CC BY 4.0 |
| Dock leveler | Buildings & Infrastructure | Dock loading ramp | [rec_dock_loading_ramp_37614f47a0e04dda88eb15c4513c418e](https://github.com/mattzh72/articraft-data/tree/main/records/rec_dock_loading_ramp_37614f47a0e04dda88eb15c4513c418e) | rev_000001 | mattzh72 | CC BY 4.0 |
| Clock tower | Buildings & Infrastructure | Clock tower with rotating hour and minute hands | [rec_clock_tower_with_rotating_hour_and_minute_hands_02c304ccc35d4f17b5aee6d5ba5e07a6](https://github.com/mattzh72/articraft-data/tree/main/records/rec_clock_tower_with_rotating_hour_and_minute_hands_02c304ccc35d4f17b5aee6d5ba5e07a6) | rev_000001 | Zhaomou Song | CC BY 4.0 |
| Exercise bike | Outdoor & Recreation | Stationary exercise bike | [rec_stationary_exercise_bike_4e344677af4347e78b5da55907b34be5](https://github.com/mattzh72/articraft-data/tree/main/records/rec_stationary_exercise_bike_4e344677af4347e78b5da55907b34be5) | rev_000001 | RuiningLi | CC BY 4.0 |
| Folding weight bench | Outdoor & Recreation | Adjustable weight bench with hinged backrest | [rec_adjustable_weight_bench_with_hinged_backrest_ac226be3f7e643cea38ac6e89be5fb8a](https://github.com/mattzh72/articraft-data/tree/main/records/rec_adjustable_weight_bench_with_hinged_backrest_ac226be3f7e643cea38ac6e89be5fb8a) | rev_000001 | mattzh72 | CC BY 4.0 |
| Wind turbine | Outdoor & Recreation | Wind turbine | [rec_wind_turbine_8fe0a625129e4da088c8f10e241ebd13](https://github.com/mattzh72/articraft-data/tree/main/records/rec_wind_turbine_8fe0a625129e4da088c8f10e241ebd13) | rev_000001 | RuiningLi | CC BY 4.0 |
| Desk globe | Outdoor & Recreation | Globe | [rec_globe_3dfdcdb0007d48f59136d9212f155f76](https://github.com/mattzh72/articraft-data/tree/main/records/rec_globe_3dfdcdb0007d48f59136d9212f155f76) | rev_000001 | mattzh72 | CC BY 4.0 |
| Cocktail-table arcade cabinet | Commercial Coin-Op & Vending | Arcade Machine | [rec_arcade_machine_b1e034f7e0434758aa30cbdb8951c32e](https://github.com/mattzh72/articraft-data/tree/main/records/rec_arcade_machine_b1e034f7e0434758aa30cbdb8951c32e) | rev_000001 | mattzh72 | CC BY 4.0 |
