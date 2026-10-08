// ============================================================================
//  IMAGE WORLDS  ·  three-addons/loaders/gltf/userdata.js
//
//  The two functions that copy glTF extras and unknown
//  extensions into object.userData.
//
//  Split from three.js r185 examples/jsm/loaders/GLTFLoader.js (MIT, see
//  three-addons/LICENSE). The code is upstream code, moved without change.
//
//  GREP
//    function addUnknownExtensionsToUserData
//    function assignExtrasToUserData
// ============================================================================

export function addUnknownExtensionsToUserData( knownExtensions, object, objectDef ) {

	// Add unknown glTF extensions to an object's userData.

	for ( const name in objectDef.extensions ) {

		if ( knownExtensions[ name ] === undefined ) {

			object.userData.gltfExtensions = object.userData.gltfExtensions || {};
			object.userData.gltfExtensions[ name ] = objectDef.extensions[ name ];

		}

	}

}

/**
 *
 * @private
 * @param {Object3D|Material|BufferGeometry|Object|AnimationClip} object
 * @param {GLTF.definition} gltfDef
 */
export function assignExtrasToUserData( object, gltfDef ) {

	if ( gltfDef.extras !== undefined ) {

		if ( typeof gltfDef.extras === 'object' ) {

			Object.assign( object.userData, gltfDef.extras );

		} else {

			console.warn( 'THREE.GLTFLoader: Ignoring primitive type .extras, ' + gltfDef.extras );

		}

	}

}
