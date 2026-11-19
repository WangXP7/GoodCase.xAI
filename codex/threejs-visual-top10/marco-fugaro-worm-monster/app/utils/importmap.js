// The import map the example pages share. Load it as a classic script, before any module script:
//
//   <script src="../utils/importmap.js"></script>
//
// Browsers only read import maps written inline, so this script writes one in after itself.

{
  const three = 'https://cdn.jsdelivr.net/npm/three@0.187.0'
  const lilGui = 'https://cdn.jsdelivr.net/npm/lil-gui@0.21.0'
  const statsGl = 'https://cdn.jsdelivr.net/npm/stats-gl@4.2.3'

  const importMap = document.createElement('script')
  importMap.type = 'importmap'
  importMap.textContent = JSON.stringify({
    imports: {
      three: `${three}/build/three.webgpu.js`,
      'three/webgpu': `${three}/build/three.webgpu.js`,
      'three/tsl': `${three}/build/three.tsl.js`,
      'three/addons/': `${three}/examples/jsm/`,
      'lil-gui': `${lilGui}/dist/lil-gui.esm.js`,
      'stats-gl': `${statsGl}/dist/main.js`,
    },
  })
  document.currentScript.after(importMap)
}
