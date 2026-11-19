// Deno-compatible system functions
// Replaces browser-specific parts of sys.js for server use

let sys_initialized = false;

export function Sys_Init() {
	if (sys_initialized) return;
	sys_initialized = true;
	console.log('Quake Server (Deno) initializing...');
}

export function Sys_Error(error) {
	console.error('Sys_Error:', error);
	Deno.exit(1);
}

export function Sys_Printf(fmt, ...args) {
	// Simple printf-style formatting
	let output = fmt;
	let argIndex = 0;
	output = output.replace(/%[sdfo]/g, () => {
		if (argIndex < args.length) {
			return String(args[argIndex++]);
		}
		return '';
	});
	// Remove trailing \n since console.log adds one
	if (output.endsWith('\\n')) {
		output = output.slice(0, -2);
	} else if (output.endsWith('\n')) {
		output = output.slice(0, -1);
	}
	console.log(output);
}

export function Sys_Quit() {
	console.log('Sys_Quit');
	Deno.exit(0);
}

export function Sys_FloatTime() {
	return performance.now() / 1000;
}

// Millisecond time for higher precision needs
export function Sys_DoubleTime() {
	return performance.now() / 1000;
}
