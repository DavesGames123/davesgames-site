// ============================================================================
//  IMAGE WORLDS  ·  three-addons/loaders/gltf/extensions/materials.js
//
//  The material plugins.
//  Each plugin adds the parameters of one KHR_materials_* or EXT_materials_*
//  extension to the material.
//
//  Split from three.js r185 examples/jsm/loaders/GLTFLoader.js (MIT, see
//  three-addons/LICENSE). The code is upstream code, moved without change.
//
//  GREP
//    function getMaterialExtension · class GLTFMaterialsUnlitExtension
//    class GLTFMaterialsEmissiveStrengthExtension
//    class GLTFMaterialsClearcoatExtension
//    class GLTFMaterialsDispersionExtension
//    class GLTFMaterialsIridescenceExtension
//    class GLTFMaterialsSheenExtension
//    class GLTFMaterialsTransmissionExtension
//    class GLTFMaterialsVolumeExtension · class GLTFMaterialsIorExtension
//    class GLTFMaterialsSpecularExtension
//    class GLTFMaterialsBumpExtension
//    class GLTFMaterialsAnisotropyExtension
// ============================================================================
import {
	Color,
	LinearSRGBColorSpace,
	MeshBasicMaterial,
	MeshPhysicalMaterial,
	Vector2,
	SRGBColorSpace
} from 'three';
import { EXTENSIONS } from '../constants.js';

function getMaterialExtension( parser, materialIndex, extensionName ) {

	const materialDef = parser.json.materials[ materialIndex ];

	if ( materialDef.extensions && materialDef.extensions[ extensionName ] ) {

		return materialDef.extensions[ extensionName ];

	}

	return null;

}

/**
 * Unlit Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_unlit
 *
 * @private
 */
export class GLTFMaterialsUnlitExtension {

	constructor() {

		this.name = EXTENSIONS.KHR_MATERIALS_UNLIT;

	}

	getMaterialType() {

		return MeshBasicMaterial;

	}

	extendParams( materialParams, materialDef, parser ) {

		const pending = [];

		materialParams.color = new Color( 1.0, 1.0, 1.0 );
		materialParams.opacity = 1.0;

		const metallicRoughness = materialDef.pbrMetallicRoughness;

		if ( metallicRoughness ) {

			if ( Array.isArray( metallicRoughness.baseColorFactor ) ) {

				const array = metallicRoughness.baseColorFactor;

				materialParams.color.setRGB( array[ 0 ], array[ 1 ], array[ 2 ], LinearSRGBColorSpace );
				materialParams.opacity = array[ 3 ];

			}

			if ( metallicRoughness.baseColorTexture !== undefined ) {

				pending.push( parser.assignTexture( materialParams, 'map', metallicRoughness.baseColorTexture, SRGBColorSpace ) );

			}

		}

		return Promise.all( pending );

	}

}

/**
 * Materials Emissive Strength Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/blob/5768b3ce0ef32bc39cdf1bef10b948586635ead3/extensions/2.0/Khronos/KHR_materials_emissive_strength/README.md
 *
 * @private
 */
export class GLTFMaterialsEmissiveStrengthExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.KHR_MATERIALS_EMISSIVE_STRENGTH;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		if ( extension.emissiveStrength !== undefined ) {

			materialParams.emissiveIntensity = extension.emissiveStrength;

		}

		return Promise.resolve();

	}

}

/**
 * Clearcoat Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_clearcoat
 *
 * @private
 */
export class GLTFMaterialsClearcoatExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.KHR_MATERIALS_CLEARCOAT;

	}

	getMaterialType( materialIndex ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		return extension !== null ? MeshPhysicalMaterial : null;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		const pending = [];

		if ( extension.clearcoatFactor !== undefined ) {

			materialParams.clearcoat = extension.clearcoatFactor;

		}

		if ( extension.clearcoatTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'clearcoatMap', extension.clearcoatTexture ) );

		}

		if ( extension.clearcoatRoughnessFactor !== undefined ) {

			materialParams.clearcoatRoughness = extension.clearcoatRoughnessFactor;

		}

		if ( extension.clearcoatRoughnessTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'clearcoatRoughnessMap', extension.clearcoatRoughnessTexture ) );

		}

		if ( extension.clearcoatNormalTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'clearcoatNormalMap', extension.clearcoatNormalTexture ) );

			if ( extension.clearcoatNormalTexture.scale !== undefined ) {

				const scale = extension.clearcoatNormalTexture.scale;

				materialParams.clearcoatNormalScale = new Vector2( scale, scale );

			}

		}

		return Promise.all( pending );

	}

}

/**
 * Materials dispersion Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_dispersion
 *
 * @private
 */
export class GLTFMaterialsDispersionExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.KHR_MATERIALS_DISPERSION;

	}

	getMaterialType( materialIndex ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		return extension !== null ? MeshPhysicalMaterial : null;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		materialParams.dispersion = extension.dispersion !== undefined ? extension.dispersion : 0;

		return Promise.resolve();

	}

}

/**
 * Iridescence Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_iridescence
 *
 * @private
 */
export class GLTFMaterialsIridescenceExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.KHR_MATERIALS_IRIDESCENCE;

	}

	getMaterialType( materialIndex ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		return extension !== null ? MeshPhysicalMaterial : null;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		const pending = [];

		if ( extension.iridescenceFactor !== undefined ) {

			materialParams.iridescence = extension.iridescenceFactor;

		}

		if ( extension.iridescenceTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'iridescenceMap', extension.iridescenceTexture ) );

		}

		if ( extension.iridescenceIor !== undefined ) {

			materialParams.iridescenceIOR = extension.iridescenceIor;

		}

		if ( materialParams.iridescenceThicknessRange === undefined ) {

			materialParams.iridescenceThicknessRange = [ 100, 400 ];

		}

		if ( extension.iridescenceThicknessMinimum !== undefined ) {

			materialParams.iridescenceThicknessRange[ 0 ] = extension.iridescenceThicknessMinimum;

		}

		if ( extension.iridescenceThicknessMaximum !== undefined ) {

			materialParams.iridescenceThicknessRange[ 1 ] = extension.iridescenceThicknessMaximum;

		}

		if ( extension.iridescenceThicknessTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'iridescenceThicknessMap', extension.iridescenceThicknessTexture ) );

		}

		return Promise.all( pending );

	}

}

/**
 * Sheen Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_sheen
 *
 * @private
 */
export class GLTFMaterialsSheenExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.KHR_MATERIALS_SHEEN;

	}

	getMaterialType( materialIndex ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		return extension !== null ? MeshPhysicalMaterial : null;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		const pending = [];

		materialParams.sheenColor = new Color( 0, 0, 0 );
		materialParams.sheenRoughness = 0;
		materialParams.sheen = 1;

		if ( extension.sheenColorFactor !== undefined ) {

			const colorFactor = extension.sheenColorFactor;
			materialParams.sheenColor.setRGB( colorFactor[ 0 ], colorFactor[ 1 ], colorFactor[ 2 ], LinearSRGBColorSpace );

		}

		if ( extension.sheenRoughnessFactor !== undefined ) {

			materialParams.sheenRoughness = extension.sheenRoughnessFactor;

		}

		if ( extension.sheenColorTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'sheenColorMap', extension.sheenColorTexture, SRGBColorSpace ) );

		}

		if ( extension.sheenRoughnessTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'sheenRoughnessMap', extension.sheenRoughnessTexture ) );

		}

		return Promise.all( pending );

	}

}

/**
 * Transmission Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_transmission
 * Draft: https://github.com/KhronosGroup/glTF/pull/1698
 *
 * @private
 */
export class GLTFMaterialsTransmissionExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.KHR_MATERIALS_TRANSMISSION;

	}

	getMaterialType( materialIndex ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		return extension !== null ? MeshPhysicalMaterial : null;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		const pending = [];

		if ( extension.transmissionFactor !== undefined ) {

			materialParams.transmission = extension.transmissionFactor;

		}

		if ( extension.transmissionTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'transmissionMap', extension.transmissionTexture ) );

		}

		return Promise.all( pending );

	}

}

/**
 * Materials Volume Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_volume
 *
 * @private
 */
export class GLTFMaterialsVolumeExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.KHR_MATERIALS_VOLUME;

	}

	getMaterialType( materialIndex ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		return extension !== null ? MeshPhysicalMaterial : null;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		const pending = [];

		materialParams.thickness = extension.thicknessFactor !== undefined ? extension.thicknessFactor : 0;

		if ( extension.thicknessTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'thicknessMap', extension.thicknessTexture ) );

		}

		materialParams.attenuationDistance = extension.attenuationDistance || Infinity;

		const colorArray = extension.attenuationColor || [ 1, 1, 1 ];
		materialParams.attenuationColor = new Color().setRGB( colorArray[ 0 ], colorArray[ 1 ], colorArray[ 2 ], LinearSRGBColorSpace );

		return Promise.all( pending );

	}

}

/**
 * Materials ior Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_ior
 *
 * @private
 */
export class GLTFMaterialsIorExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.KHR_MATERIALS_IOR;

	}

	getMaterialType( materialIndex ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		return extension !== null ? MeshPhysicalMaterial : null;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		materialParams.ior = extension.ior !== undefined ? extension.ior : 1.5;

		if ( materialParams.ior === 0 ) materialParams.ior = 1000; // see #26167

		return Promise.resolve();

	}

}

/**
 * Materials specular Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_specular
 *
 * @private
 */
export class GLTFMaterialsSpecularExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.KHR_MATERIALS_SPECULAR;

	}

	getMaterialType( materialIndex ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		return extension !== null ? MeshPhysicalMaterial : null;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		const pending = [];

		materialParams.specularIntensity = extension.specularFactor !== undefined ? extension.specularFactor : 1.0;

		if ( extension.specularTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'specularIntensityMap', extension.specularTexture ) );

		}

		const colorArray = extension.specularColorFactor || [ 1, 1, 1 ];
		materialParams.specularColor = new Color().setRGB( colorArray[ 0 ], colorArray[ 1 ], colorArray[ 2 ], LinearSRGBColorSpace );

		if ( extension.specularColorTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'specularColorMap', extension.specularColorTexture, SRGBColorSpace ) );

		}

		return Promise.all( pending );

	}

}


/**
 * Materials bump Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/EXT_materials_bump
 *
 * @private
 */
export class GLTFMaterialsBumpExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.EXT_MATERIALS_BUMP;

	}

	getMaterialType( materialIndex ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		return extension !== null ? MeshPhysicalMaterial : null;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		const pending = [];

		materialParams.bumpScale = extension.bumpFactor !== undefined ? extension.bumpFactor : 1.0;

		if ( extension.bumpTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'bumpMap', extension.bumpTexture ) );

		}

		return Promise.all( pending );

	}

}

/**
 * Materials anisotropy Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_anisotropy
 *
 * @private
 */
export class GLTFMaterialsAnisotropyExtension {

	constructor( parser ) {

		this.parser = parser;
		this.name = EXTENSIONS.KHR_MATERIALS_ANISOTROPY;

	}

	getMaterialType( materialIndex ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		return extension !== null ? MeshPhysicalMaterial : null;

	}

	extendMaterialParams( materialIndex, materialParams ) {

		const extension = getMaterialExtension( this.parser, materialIndex, this.name );

		if ( extension === null ) return Promise.resolve();

		const pending = [];

		if ( extension.anisotropyStrength !== undefined ) {

			materialParams.anisotropy = extension.anisotropyStrength;

		}

		if ( extension.anisotropyRotation !== undefined ) {

			materialParams.anisotropyRotation = extension.anisotropyRotation;

		}

		if ( extension.anisotropyTexture !== undefined ) {

			pending.push( this.parser.assignTexture( materialParams, 'anisotropyMap', extension.anisotropyTexture ) );

		}

		return Promise.all( pending );

	}

}
