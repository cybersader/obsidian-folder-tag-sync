import type { SupportPlatformInfo } from './collectSupportSnapshot';

export interface SupportPlatformFlags {
	isIosApp: boolean;
	isAndroidApp: boolean;
	isWin: boolean;
	isMacOS: boolean;
	isLinux: boolean;
	isMobile: boolean;
	isDesktop: boolean;
	isDesktopApp: boolean;
	isMobileApp: boolean;
}

/** Convert Obsidian's overlapping Platform flags into one stable support value. */
export function collectSupportPlatformInfo(
	platform: SupportPlatformFlags,
): SupportPlatformInfo {
	let os: SupportPlatformInfo['os'] = 'unknown';
	if (platform.isIosApp) os = 'ios';
	else if (platform.isAndroidApp) os = 'android';
	else if (platform.isWin) os = 'windows';
	else if (platform.isMacOS) os = 'macos';
	else if (platform.isLinux) os = 'linux';

	return {
		kind: platform.isMobile ? 'mobile' : platform.isDesktop ? 'desktop' : 'unknown',
		os,
		isDesktopApp: platform.isDesktopApp,
		isMobileApp: platform.isMobileApp,
	};
}
