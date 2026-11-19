// Test that Deno can import the existing JS modules from src/
// Run with: deno run --allow-read test_imports.js

// Import browser shim first to set up globalThis.THREE
import './browser_shim.js';

console.log('Testing imports from ../src/...');

// Test basic modules
try {
	const { Sys_Printf, Sys_FloatTime } = await import('../src/sys.js');
	console.log('✓ sys.js imported');
	Sys_Printf('  Test printf: %s', 'works!');
} catch (e) {
	console.error('✗ sys.js failed:', e.message);
}

try {
	const mathlib = await import('../src/mathlib.js');
	console.log('✓ mathlib.js imported');
} catch (e) {
	console.error('✗ mathlib.js failed:', e.message);
}

try {
	const quakedef = await import('../src/quakedef.js');
	console.log('✓ quakedef.js imported');
} catch (e) {
	console.error('✗ quakedef.js failed:', e.message);
}

try {
	const protocol = await import('../src/protocol.js');
	console.log('✓ protocol.js imported');
} catch (e) {
	console.error('✗ protocol.js failed:', e.message);
}

try {
	const common = await import('../src/common.js');
	console.log('✓ common.js imported');
} catch (e) {
	console.error('✗ common.js failed:', e.message);
}

try {
	const server = await import('../src/server.js');
	console.log('✓ server.js imported');
} catch (e) {
	console.error('✗ server.js failed:', e.message);
}

// Test server modules
try {
	const sv_main = await import('../src/sv_main.js');
	console.log('✓ sv_main.js imported');
} catch (e) {
	console.error('✗ sv_main.js failed:', e.message);
}

try {
	const sv_phys = await import('../src/sv_phys.js');
	console.log('✓ sv_phys.js imported');
} catch (e) {
	console.error('✗ sv_phys.js failed:', e.message);
}

try {
	const world = await import('../src/world.js');
	console.log('✓ world.js imported');
} catch (e) {
	console.error('✗ world.js failed:', e.message);
}

// Test QuakeC modules
try {
	const pr_exec = await import('../src/pr_exec.js');
	console.log('✓ pr_exec.js imported');
} catch (e) {
	console.error('✗ pr_exec.js failed:', e.message);
}

try {
	const pr_edict = await import('../src/pr_edict.js');
	console.log('✓ pr_edict.js imported');
} catch (e) {
	console.error('✗ pr_edict.js failed:', e.message);
}

// Test model loading (uses THREE)
try {
	const gl_model = await import('../src/gl_model.js');
	console.log('✓ gl_model.js imported');
} catch (e) {
	console.error('✗ gl_model.js failed:', e.message);
}

console.log('\nImport test complete!');
