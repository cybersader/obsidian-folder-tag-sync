/**
 * Case transformation utilities
 *
 * Provides bidirectional transformations between different naming conventions.
 */

/**
 * Convert string to snake_case
 * Example: "My Project Name" -> "my_project_name"
 */
export function toSnakeCase(input: string): string {
	return input
		// Handle camelCase and PascalCase
		.replace(/([A-Z])/g, '_$1')
		// Replace spaces and hyphens with underscores
		.replace(/[\s\-]+/g, '_')
		// Convert to lowercase
		.toLowerCase()
		// Remove leading underscore
		.replace(/^_/, '')
		// Remove multiple consecutive underscores
		.replace(/_+/g, '_');
}

/**
 * Convert string to Title Case
 * Example: "my_project_name" -> "My Project Name"
 */
export function toTitleCase(input: string): string {
	return input
		// Replace underscores and hyphens with spaces
		.replace(/[_\-]+/g, ' ')
		// Capitalize first letter of each word
		.replace(/\b\w/g, (char) => char.toUpperCase())
		// Clean up multiple spaces
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Convert string to kebab-case
 * Example: "My Project Name" -> "my-project-name"
 */
export function toKebabCase(input: string): string {
	return input
		.replace(/([A-Z])/g, '-$1')
		.replace(/[\s_]+/g, '-')
		.toLowerCase()
		.replace(/^-/, '')
		.replace(/-+/g, '-');
}

/**
 * Convert string to camelCase
 * Example: "my project name" -> "myProjectName"
 */
export function toCamelCase(input: string): string {
	return input
		.replace(/[\s_\-]+(.)/g, (_, char) => char.toUpperCase())
		.replace(/^(.)/, (char) => char.toLowerCase());
}

/**
 * Convert string to PascalCase
 * Example: "my project name" -> "MyProjectName"
 */
export function toPascalCase(input: string): string {
	return input
		.replace(/[\s_\-]+(.)/g, (_, char) => char.toUpperCase())
		.replace(/^(.)/, (char) => char.toUpperCase());
}

/**
 * Apply case transformation based on type
 */
export function applyCaseTransform(input: string, transformType: string): string {
	switch (transformType) {
		case 'snake_case':
			return toSnakeCase(input);
		case 'Title Case':
			return toTitleCase(input);
		case 'kebab-case':
			return toKebabCase(input);
		case 'camelCase':
			return toCamelCase(input);
		case 'PascalCase':
			return toPascalCase(input);
		case 'lowercase':
			return input.toLowerCase();
		case 'UPPERCASE':
			return input.toUpperCase();
		case 'none':
		default:
			return input;
	}
}

/**
 * Apply case transformation to each path segment separately
 * This prevents issues with leading/trailing characters after slashes
 */
export function applyCaseTransformToPath(input: string, transformType: string): string {
	// Split by forward slash, transform each segment, rejoin
	return input
		.split('/')
		.map(segment => applyCaseTransform(segment, transformType))
		.join('/');
}
