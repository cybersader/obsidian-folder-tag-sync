import { App, normalizePath } from 'obsidian';

/**
 * Debug logger that writes to both console and a file.
 * File logging enables Claude Code to see runtime behavior.
 */
export class DebugLogger {
  private logPath: string;
  private enabled: boolean;

  constructor(private app: App, enabled: boolean = false) {
    this.enabled = enabled;
    // Use vault's config directory for log file
    this.logPath = normalizePath(
      `${app.vault.configDir}/plugins/dynamic-tags-folders/debug.log`
    );
  }

  /**
   * Log a message at the specified level
   */
  async log(level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const dataStr = data ? '\n' + JSON.stringify(data, null, 2) : '';
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`;

    // Write to file
    try {
      const adapter = this.app.vault.adapter;
      let existing = '';
      try {
        existing = await adapter.read(this.logPath);
      } catch {
        // File doesn't exist yet, that's fine
      }
      await adapter.write(this.logPath, existing + logEntry);
    } catch (e) {
      console.error('Failed to write debug log:', e);
    }

    // Also log to console for immediate visibility
    if (level === 'info') {
      console.debug(message, data);
    } else if (level === 'warn') {
      console.warn(message, data);
    } else {
      console.error(message, data);
    }
  }

  /**
   * Clear the debug log file
   */
  async clear() {
    if (!this.enabled) return;

    try {
      await this.app.vault.adapter.write(this.logPath, '');
    } catch (e) {
      console.error('Failed to clear debug log:', e);
    }
  }

  /**
   * Log an info-level message
   */
  info(message: string, data?: Record<string, unknown>) {
    return this.log('info', message, data);
  }

  /**
   * Log a warning-level message
   */
  warn(message: string, data?: Record<string, unknown>) {
    return this.log('warn', message, data);
  }

  /**
   * Log an error-level message
   */
  error(message: string, data?: Record<string, unknown>) {
    return this.log('error', message, data);
  }

  /**
   * Get the path to the log file
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Check if debug logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable debug logging
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }
}
