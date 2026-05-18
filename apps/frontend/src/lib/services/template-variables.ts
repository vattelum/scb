/**
 * Shared utility for parsing template variable schemas from YAML frontmatter.
 * Used by the contract create form, the propose/vote summary lists, and the
 * homepage "Contract Template" detection.
 *
 * Templates in the Contract Templates category may additionally declare a
 * `roles:` block listing the abstract parties this contract is between.
 * Role keys are referenced in the template body as `{{role_key}}` and resolve
 * to the role label at render time.
 */

export interface TemplateVariable {
	name: string;
	label: string;
	type: string;
	required: boolean;
}

export interface TemplateRole {
	key: string;
	label: string;
}

/**
 * Parse `variables:` block from document YAML frontmatter.
 * Returns structured variable definitions, or empty array if none found.
 */
export function parseVariableSchema(content: string): TemplateVariable[] {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return [];

	const yamlBlock = fmMatch[1];
	if (!yamlBlock.includes('variables:')) return [];

	// Match the variables block: everything after "variables:" until the next top-level key or end
	const varsMatch = yamlBlock.match(/variables:\n((?:\s+-[\s\S]*?)*)(?=\n\w|\s*$)/);
	if (!varsMatch) return [];

	const entries = varsMatch[1].split(/\n\s*-\s*/).filter(Boolean);

	return entries
		.map((entry) => {
			const nameMatch = entry.match(/name:\s*"?([^"\n,}]+)"?/);
			const labelMatch = entry.match(/label:\s*"?([^"\n,}]+)"?/);
			const typeMatch = entry.match(/type:\s*"?([^"\n,}]+)"?/);
			const reqMatch = entry.match(/required:\s*(true|false)/);

			const name = nameMatch?.[1]?.trim() ?? '';
			// Normalise legacy `type: "string"` (used by older TemplateVarsEditor
			// versions) to the HTML-input-aligned `'text'` so downstream consumers
			// see one canonical value. Existing templates with `"string"` continue
			// to render correctly because VariablesSection's fallback already
			// produces `<input type="text">` for any non-`number` value.
			let type = typeMatch?.[1]?.trim() ?? 'text';
			if (type === 'string') type = 'text';
			return {
				name,
				label: labelMatch?.[1]?.trim() ?? name,
				type,
				required: reqMatch?.[1] === 'true'
			};
		})
		.filter((v) => v.name);
}

/**
 * Returns true if the document content has a `variables:` block in its frontmatter.
 * Used for lightweight detection without full parsing.
 */
export function hasVariableSchema(content: string): boolean {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return false;
	return fmMatch[1].includes('variables:');
}

/**
 * Serialize an array of TemplateVariable into a YAML variables: block
 * suitable for inclusion in document frontmatter.
 */
export function serializeVariableSchema(variables: TemplateVariable[]): string {
	if (variables.length === 0) return '';
	const entries = variables.map((v) =>
		`  - name: "${v.name}"\n    label: "${v.label}"\n    type: "${v.type}"\n    required: ${v.required}`
	).join('\n');
	return `variables:\n${entries}`;
}

// ──────────────────── Roles ──────────────────────────────────

/**
 * Parse `roles:` block from document YAML frontmatter.
 * Returns declared roles in declaration order; empty array if absent.
 */
export function parseRoleSchema(content: string): TemplateRole[] {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return [];

	const yamlBlock = fmMatch[1];
	if (!yamlBlock.includes('roles:')) return [];

	const rolesMatch = yamlBlock.match(/roles:\n((?:\s+-[\s\S]*?)*)(?=\n\w|\s*$)/);
	if (!rolesMatch) return [];

	const entries = rolesMatch[1].split(/\n\s*-\s*/).filter(Boolean);

	return entries
		.map((entry) => {
			const keyMatch = entry.match(/key:\s*"?([^"\n,}]+)"?/);
			const labelMatch = entry.match(/label:\s*"?([^"\n,}]+)"?/);
			const key = keyMatch?.[1]?.trim() ?? '';
			return { key, label: labelMatch?.[1]?.trim() ?? key };
		})
		.filter((r) => r.key);
}

/** Serialize TemplateRole[] as a YAML `roles:` block for inclusion in frontmatter. */
export function serializeRoleSchema(roles: TemplateRole[]): string {
	if (roles.length === 0) return '';
	const entries = roles.map((r) =>
		`  - key: "${r.key}"\n    label: "${r.label}"`
	).join('\n');
	return `roles:\n${entries}`;
}

/**
 * Slugify a free-text label into a role key: lowercase, non-alphanumeric → `_`,
 * trim leading/trailing underscores, collapse repeats. Used by RolesEditor to
 * auto-derive `key` from `label`.
 */
export function slugifyRoleKey(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/_+/g, '_');
}

