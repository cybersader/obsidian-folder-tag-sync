#!/usr/bin/env node
/**
 * Platform-aware build script
 *
 * Detects the environment (WSL, PowerShell, Linux, macOS) and runs
 * the appropriate build commands.
 */

import { execSync } from 'child_process';
import { platform } from 'os';
import { existsSync } from 'fs';

// Detect environment
function detectEnvironment() {
	const os = platform();
	const isWSL = existsSync('/proc/version') &&
		execSync('cat /proc/version', { encoding: 'utf8' }).toLowerCase().includes('microsoft');

	return {
		os,
		isWSL,
		isPowerShell: os === 'win32',
		isLinux: os === 'linux' && !isWSL,
		isMacOS: os === 'darwin'
	};
}

// Get the appropriate package manager
function getPackageManager() {
	try {
		execSync('bun --version', { stdio: 'ignore' });
		return 'bun';
	} catch {
		try {
			execSync('npm --version', { stdio: 'ignore' });
			return 'npm';
		} catch {
			throw new Error('Neither bun nor npm found. Please install one of them.');
		}
	}
}

// Main build function
function build() {
	const env = detectEnvironment();
	const pm = getPackageManager();
	const isProd = process.argv.includes('--production') || process.argv.includes('production');

	console.log('🔍 Environment detected:');
	console.log(`   OS: ${env.os}`);
	console.log(`   WSL: ${env.isWSL ? 'Yes' : 'No'}`);
	console.log(`   Package Manager: ${pm}`);
	console.log(`   Mode: ${isProd ? 'Production' : 'Development'}`);
	console.log('');

	try {
		// Step 1: TypeScript type checking
		console.log('📝 Running TypeScript type checking...');
		const tscCmd = pm === 'bun' ? 'bun x tsc' : 'npx tsc';
		execSync(`${tscCmd} -noEmit -skipLibCheck`, { stdio: 'inherit' });
		console.log('✅ TypeScript check passed\n');

		// Step 2: Bundle with esbuild
		console.log('📦 Bundling with esbuild...');
		const esbuildCmd = pm === 'bun' ? 'bun run esbuild.config.mjs' : 'node esbuild.config.mjs';
		execSync(`${esbuildCmd}${isProd ? ' production' : ''}`, { stdio: 'inherit' });
		console.log('✅ Build complete\n');

		console.log('🎉 Success! Plugin is ready.');
		console.log('📁 Output: main.js');

	} catch (error) {
		console.error('\n❌ Build failed:', error.message);
		process.exit(1);
	}
}

// Run build
build();
