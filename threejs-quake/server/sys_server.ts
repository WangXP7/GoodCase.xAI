// Server-side system interface for Deno
// Replaces browser sys.js for the dedicated server

export function Sys_Init(): void {
	console.log('Three-Quake Dedicated Server initializing...');
}

export function Sys_Error(error: string): never {
	console.error('Sys_Error:', error);
	Deno.exit(1);
}

const _quietLogAllowPatterns: RegExp[] = [
	/^Connection from /,
	/^Connection closed:/,
	/^Client .*(connected|removed)\b/,
	/^Spawning server for map:/,
	/^SpawnServer:/,
	/^Server initialized!/,
	/^Room .* idle for /,
	/^Host_ServerFrame error:/,
	/^SV_ReadClientMessage:/,
	/^Unhandled promise rejection:/,
	/^WebTransport server listening /,
	/^WebTransport server driver initialized/,
	/^NET_Init complete/,
];

function _shouldPrintLine(line: string): boolean {
	const quietLogs = (globalThis as { __THREE_QUAKE_QUIET_LOGS?: boolean })
		.__THREE_QUAKE_QUIET_LOGS === true;
	if (!quietLogs) return true;

	const trimmed = line.trim();
	if (trimmed.length === 0) return false;

	for (const pattern of _quietLogAllowPatterns) {
		if (pattern.test(trimmed)) return true;
	}

	return false;
}

export function Sys_Printf(fmt: string, ...args: unknown[]): void {
	let result: string;
	if (args.length > 0) {
		// Simple printf-style formatting
		result = fmt;
		for (const arg of args) {
			result = result.replace(/%[sdif]/, String(arg));
		}
	} else {
		result = fmt;
	}

	if (_shouldPrintLine(result) === false) {
		return;
	}

	console.log(result);
}

export function Sys_Quit(): void {
	console.log('Sys_Quit');
	Deno.exit(0);
}

export function Sys_FloatTime(): number {
	return performance.now() / 1000.0;
}

export function Sys_DoubleTime(): number {
	return performance.now() / 1000.0;
}

// Server-specific: milliseconds for precise timing
export function Sys_Milliseconds(): number {
	return performance.now();
}
