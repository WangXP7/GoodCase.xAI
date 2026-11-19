/**
 * LandscapeEngine — shared geometry & flora mixin.
 *
 * Builds the shared rock/pine/cactus/shrub/boulder geometries used by
 * instanced chunk decoration, plus the shared flora materials and the
 * `terrainMat` Lambert material with onBeforeCompile clip-bounds
 * injection. Attaches `_initSharedGeometries`, `_mergeColored`, and the
 * flora `_build*Geo` helpers to LandscapeEngine.prototype.
 *
 * Depends on: LandscapeEngine being defined globally and window.THREE.
 */
(function (global) {
  if (!global.LandscapeEngine) {
    throw new Error('engine/landscape/geometries.js: LandscapeEngine must be loaded first.');
  }
  const THREE = global.THREE;
  if (!THREE) {
    throw new Error('engine/landscape/geometries.js: THREE must be loaded first.');
  }

  Object.assign(global.LandscapeEngine.prototype, {
    // --- Geometry Instancing Helpers ---
    _initSharedGeometries() {
      this.rockGeo = (() => {
        const g = new THREE.DodecahedronGeometry(1, 0);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          const n = Math.sin(x * 4.7 + this.seed) * Math.cos(y * 3.1) * Math.sin(z * 5.3);
          p.setXYZ(i, x * (1 + n * 0.28), y * (1 + n * 0.18), z * (1 + n * 0.22));
        }
        g.computeVertexNormals();
        return g;
      })();
      this.rockMat = new THREE.MeshLambertMaterial({ color: 0x9c6840 });
      this.rockMatLowPoly = new THREE.MeshPhongMaterial({ color: 0x9c6840, flatShading: true, shininess: 0 });

      this.pineGeo = this._buildPineGeo();
      this.cactusGeo = this._buildCactusGeo();
      this.shrubGeo = this._buildShrubGeo();
      this.boulderGeo = this._buildBoulderGeo();

      const localBox = new THREE.Box3(
        new THREE.Vector3(-this.CHUNK_SIZE / 2 - 10, -100, -this.CHUNK_SIZE / 2 - 10),
        new THREE.Vector3(this.CHUNK_SIZE / 2 + 10, 500, this.CHUNK_SIZE / 2 + 10)
      );
      const localSphere = localBox.getBoundingSphere(new THREE.Sphere());
      for (const geo of [this.rockGeo, this.pineGeo, this.cactusGeo, this.shrubGeo, this.boulderGeo]) {
        geo.boundingBox = localBox.clone();
        geo.boundingSphere = localSphere.clone();
      }

      this.floraMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      this.floraMatLow = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 0 });

      // TinyWorld integration: use a built-in lit material only for the
      // realistic visible terrain path so Three.js can apply native shadow maps
      // and scene fog. Low-poly mode intentionally keeps the custom cel shader.
      this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: true });
      this.terrainMat.userData = {
        clipEnabled: { value: 0.0 }
      };
      this.terrainMat.onBeforeCompile = (shader) => {
        shader.uniforms.clipMin = { value: this._clipMin };
        shader.uniforms.clipMax = { value: this._clipMax };
        shader.uniforms.clipEnabled = this.terrainMat.userData.clipEnabled;

        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWorldPositionCustom;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vWorldPositionCustom = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>
          uniform vec3 clipMin;
          uniform vec3 clipMax;
          uniform float clipEnabled;
          varying vec3 vWorldPositionCustom;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <fog_fragment>',
          `#include <fog_fragment>
          if (clipEnabled > 0.5) {
            float dx1 = vWorldPositionCustom.x - clipMin.x;
            float dx2 = clipMax.x - vWorldPositionCustom.x;
            float dz1 = vWorldPositionCustom.z - clipMin.z;
            float dz2 = clipMax.z - vWorldPositionCustom.z;
            float minDist = min(min(dx1, dx2), min(dz1, dz2));
            if (minDist < 0.0) {
              discard;
            }
          }`
        );
      };
    },

    _mergeColored(entries) {
      let total = 0;
      for (const e of entries) total += e.geo.attributes.position.count;
      const positions = new Float32Array(total * 3);
      const normals = new Float32Array(total * 3);
      const colors = new Float32Array(total * 3);
      const indices = [];
      let vOff = 0;
      for (const e of entries) {
        const pg = e.geo;
        const pn = pg.attributes.position;
        pg.computeVertexNormals();
        const nr = pg.attributes.normal;
        for (let i = 0; i < pn.count; i++) {
          positions[(vOff + i) * 3]     = pn.getX(i);
          positions[(vOff + i) * 3 + 1] = pn.getY(i);
          positions[(vOff + i) * 3 + 2] = pn.getZ(i);
          normals[(vOff + i) * 3]     = nr.getX(i);
          normals[(vOff + i) * 3 + 1] = nr.getY(i);
          normals[(vOff + i) * 3 + 2] = nr.getZ(i);
          colors[(vOff + i) * 3]     = e.col.r;
          colors[(vOff + i) * 3 + 1] = e.col.g;
          colors[(vOff + i) * 3 + 2] = e.col.b;
        }
        const idx = pg.index;
        if (idx) {
          for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vOff);
        } else {
          for (let i = 0; i < pn.count; i++) indices.push(i + vOff);
        }
        vOff += pn.count;
        pg.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      out.setIndex(indices);
      return out;
    },

    _buildPineGeo() {
      const geos = [];
      const trunk = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6);
      trunk.translate(0, 1.1, 0);
      geos.push({ geo: trunk, col: new THREE.Color(0x5d3a1a) });
      for (let i = 0; i < 4; i++) {
        const c = new THREE.ConeGeometry(1.5 - i * 0.22, 1.8, 6);
        c.translate(0, 2.5 + i * 0.85, 0);
        geos.push({ geo: c, col: new THREE.Color(i % 2 === 0 ? 0x2d6a2a : 0x3a8a38) });
      }
      return this._mergeColored(geos);
    },

    _buildCactusGeo() {
      const geos = [];
      const col = new THREE.Color(0x4a7a3a);
      const body = new THREE.CylinderGeometry(0.35, 0.42, 2.4, 8);
      body.translate(0, 1.2, 0);
      geos.push({ geo: body, col });

      const armL = new THREE.CylinderGeometry(0.18, 0.22, 0.9, 7);
      armL.rotateZ(Math.PI / 2);
      armL.translate(-0.6, 1.5, 0);
      geos.push({ geo: armL, col });
      const armLUp = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 7);
      armLUp.translate(-1.0, 1.9, 0);
      geos.push({ geo: armLUp, col });

      const armR = new THREE.CylinderGeometry(0.16, 0.2, 0.7, 7);
      armR.rotateZ(Math.PI / 2);
      armR.translate(0.5, 1.9, 0);
      geos.push({ geo: armR, col });
      const armRUp = new THREE.CylinderGeometry(0.16, 0.16, 0.55, 7);
      armRUp.translate(0.82, 2.22, 0);
      geos.push({ geo: armRUp, col });

      const cap = new THREE.SphereGeometry(0.38, 7, 5);
      cap.translate(0, 2.38, 0);
      geos.push({ geo: cap, col });
      return this._mergeColored(geos);
    },

    _buildShrubGeo() {
      const geos = [];
      for (let i = 0; i < 5; i++) {
        const r = 0.35 + (i % 3) * 0.1;
        const d = new THREE.DodecahedronGeometry(r, 0);
        const ang = (i / 5) * Math.PI * 2;
        d.translate(Math.cos(ang) * 0.3, r * 0.7, Math.sin(ang) * 0.3);
        geos.push({ geo: d, col: new THREE.Color(0x7a5a2a) });
      }
      return this._mergeColored(geos);
    },

    _buildBoulderGeo() {
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = Math.sin(x * 5.3 + this.seed) * Math.cos(y * 3.7) * Math.sin(z * 4.1);
        p.setXYZ(i, x * (1 + n * 0.25), y * (1 + n * 0.20), z * (1 + n * 0.22));
      }
      geo.computeVertexNormals();

      const cols = new Float32Array(p.count * 3);
      const c = new THREE.Color(0xa07450);
      for (let i = 0; i < p.count; i++) {
        cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      return geo;
    },
  });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
