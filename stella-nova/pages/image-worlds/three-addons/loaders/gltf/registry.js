// ============================================================================
//  IMAGE WORLDS  ·  three-addons/loaders/gltf/registry.js
//
//  The key-value cache of the parser.
//  The parser keeps one Promise for each loaded dependency in it.
//
//  Split from three.js r185 examples/jsm/loaders/GLTFLoader.js (MIT, see
//  three-addons/LICENSE). The code is upstream code, moved without change.
//
//  GREP
//    function GLTFRegistry
// ============================================================================

export function GLTFRegistry() {

	let objects = {};

	return	{

		get: function ( key ) {

			return objects[ key ];

		},

		add: function ( key, object ) {

			objects[ key ] = object;

		},

		remove: function ( key ) {

			delete objects[ key ];

		},

		removeAll: function () {

			objects = {};

		}

	};

}
