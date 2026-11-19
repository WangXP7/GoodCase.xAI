// Indices shared by the mesher (worker) and the shaders. No dependencies, so the worker stays light.

// Surface kinds within the building mesh (aBldg.z).
export const KIND = { WALL: 0, FLAT_ROOF: 1, SOLID: 2, PITCHED_ROOF: 3, LATTICE: 4 };
// Facade categories (aBldg.y % 8), derived from the PLATEAU usage code.
export const CAT = { HOUSE: 0, APARTMENT: 1, MIXED: 2, COMMERCIAL: 3, PUBLIC: 4, GLASS: 5 };
// Texture array layers (see textures.js).
export const WALL = { TILE: 0, CONCRETE: 1, PLASTER: 2, BRICK: 3, SIDING: 4, ROOF: 5 };
export const GROUND = { ASPHALT: 0, PAVERS: 1, GRASS: 2, CONCRETE: 3, WATER: 4 }; // WATER has no texture
