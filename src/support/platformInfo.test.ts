import { describe, expect, test } from 'bun:test';
import { collectSupportPlatformInfo, type SupportPlatformFlags } from './platformInfo';

function flags(overrides: Partial<SupportPlatformFlags>): SupportPlatformFlags {
	return {
		isIosApp: false,
		isAndroidApp: false,
		isWin: false,
		isMacOS: false,
		isLinux: false,
		isMobile: false,
		isDesktop: false,
		isDesktopApp: false,
		isMobileApp: false,
		...overrides,
	};
}

describe('collectSupportPlatformInfo', () => {
	test('classifies iOS before the overlapping macOS flag', () => {
		expect(collectSupportPlatformInfo(flags({
			isIosApp: true,
			isMacOS: true,
			isMobile: true,
			isMobileApp: true,
		}))).toEqual({
			kind: 'mobile',
			os: 'ios',
			isDesktopApp: false,
			isMobileApp: true,
		});
	});

	test('reports desktop Linux without inferring mobile state', () => {
		expect(collectSupportPlatformInfo(flags({
			isLinux: true,
			isDesktop: true,
			isDesktopApp: true,
		}))).toEqual({
			kind: 'desktop',
			os: 'linux',
			isDesktopApp: true,
			isMobileApp: false,
		});
	});
});
