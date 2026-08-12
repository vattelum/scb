/**
 * Party bindings — contract-level identification of the people / entities
 * that fill the roles declared by a template.
 *
 * Required core:
 *   - Individual signer: signer_name, wallet
 *   - Entity signer:     entity.legal_name, signer_name (representative), wallet
 *
 * Everything else is optional. Blank values are omitted from the rendered
 * §1 Parties block (renderParties below). To add another optional field:
 *   - add a key on PartyBinding or EntityBinding
 *   - append an entry to INDIVIDUAL_FIELDS / ENTITY_FIELDS
 *   - expose it in PartyBlock.svelte
 * No on-chain change required — parties live exclusively in 3B.
 *
 * §1 Parties output format (role header on its own line, then fields;
 * wallet always last):
 *
 *   **{Role Label}**
 *   - Name: …              (individual) or
 *   - Entity: …            (entity) → ... → - Signer: … → - Signer's role: …
 *   - Wallet: `0x…`
 *
 * Same input → byte-identical output → same content hash across clients
 * and across time. This file is the frozen baseline per Referencing
 * Standard v10 §10.4–10.5; any format change is a hash-breaking version bump.
 */

import type { TemplateRole } from './template-variables';
import { formatISODate } from './format';

// ──────────────── Types ────────────────────────────────────────

export interface EntityBinding {
	legal_name: string;
	jurisdiction?: string;
	registration_number?: string;
	registered_address?: string;
	signer_role?: string;
	tax_id?: string;
	email?: string;
	phone?: string;
}

export interface PartyBinding {
	signer_name: string;
	wallet: `0x${string}` | '';
	email?: string;
	phone?: string;
	address?: string;
	date_of_birth?: string;
	nationality?: string;
	government_id?: string;
	tax_id?: string;
	entity?: EntityBinding;
}

/** Keyed by role.key. One entry per role declared by the template. */
export type PartyBindings = Record<string, PartyBinding>;

export function emptyPartyBinding(): PartyBinding {
	return { signer_name: '', wallet: '' };
}

export function emptyEntityBinding(): EntityBinding {
	return { legal_name: '' };
}

// ──────────────── Field metadata (form UI) ─────────────────────

/** Optional individual field keys in render order (Name and Wallet are core). */
export const INDIVIDUAL_OPTIONAL_KEYS = [
	'email',
	'phone',
	'address',
	'date_of_birth',
	'nationality',
	'government_id',
	'tax_id'
] as const;

/** Optional entity field keys (Entity name, Signer, Wallet are core). */
export const ENTITY_OPTIONAL_KEYS = [
	'jurisdiction',
	'registration_number',
	'registered_address',
	'tax_id',
	'signer_role',
	'email',
	'phone'
] as const;

export type IndividualOptionalKey = (typeof INDIVIDUAL_OPTIONAL_KEYS)[number];
export type EntityOptionalKey = (typeof ENTITY_OPTIONAL_KEYS)[number];

export const INDIVIDUAL_FIELD_LABELS: Record<IndividualOptionalKey, string> = {
	email: 'Email',
	phone: 'Phone',
	address: 'Address',
	date_of_birth: 'Date of birth',
	nationality: 'Nationality',
	government_id: 'Government ID',
	tax_id: 'Tax ID'
};

export const ENTITY_FIELD_LABELS: Record<EntityOptionalKey, string> = {
	jurisdiction: 'Jurisdiction',
	registration_number: 'Registration number',
	registered_address: 'Registered address',
	tax_id: 'Tax ID',
	signer_role: "Signer's role",
	email: 'Email',
	phone: 'Phone'
};

// ──────────────── §1 Parties renderer ──────────────────────────

type FieldExtractor = (b: PartyBinding) => string | undefined;

interface PartyField {
	label: string;
	get: FieldExtractor;
}

const INDIVIDUAL_FIELDS: PartyField[] = [
	{ label: 'Name', get: (b) => b.signer_name },
	{ label: 'Email', get: (b) => b.email },
	{ label: 'Phone', get: (b) => b.phone },
	{ label: 'Address', get: (b) => b.address },
	{ label: 'Date of birth', get: (b) => b.date_of_birth },
	{ label: 'Nationality', get: (b) => b.nationality },
	{ label: 'Government ID', get: (b) => b.government_id },
	{ label: 'Tax ID', get: (b) => b.tax_id }
];

const ENTITY_FIELDS: PartyField[] = [
	{ label: 'Entity', get: (b) => b.entity?.legal_name },
	{ label: 'Jurisdiction', get: (b) => b.entity?.jurisdiction },
	{ label: 'Registration number', get: (b) => b.entity?.registration_number },
	{ label: 'Registered address', get: (b) => b.entity?.registered_address },
	{ label: 'Tax ID', get: (b) => b.entity?.tax_id },
	{ label: 'Signer', get: (b) => b.signer_name },
	{ label: "Signer's role", get: (b) => b.entity?.signer_role },
	{ label: 'Email', get: (b) => b.entity?.email },
	{ label: 'Phone', get: (b) => b.entity?.phone }
];

const WALLET_FIELD: PartyField = {
	label: 'Wallet',
	get: (b) => b.wallet
};

/**
 * Render the §1 Parties section.
 *
 * @param roles    Roles declared by the template, in declaration order.
 * @param bindings Map keyed by role.key → PartyBinding.
 * @returns        Markdown string starting with `## §1 Parties`.
 *                 No trailing newline.
 */
export function renderParties(roles: TemplateRole[], bindings: PartyBindings): string {
	const lines: string[] = ['## §1 Parties', ''];

	for (let i = 0; i < roles.length; i++) {
		const role = roles[i];
		const b = bindings[role.key];
		if (!b) continue;

		lines.push(`**${role.label}**`);

		const emitField = (f: PartyField) => {
			const v = f.get(b);
			if (v && v.trim()) lines.push(`- ${f.label}: ${formatValue(f.label, v)}`);
		};

		if (b.entity) {
			for (const f of ENTITY_FIELDS) emitField(f);
		} else {
			for (const f of INDIVIDUAL_FIELDS) emitField(f);
		}
		emitField(WALLET_FIELD);

		if (i < roles.length - 1) lines.push('');
	}

	return lines.join('\n');
}

function formatValue(label: string, value: string): string {
	if (label === 'Wallet') return '`' + value + '`';
	return formatISODate(value);
}

/**
 * Serialize party bindings as a YAML block for archive .md frontmatter.
 * Keys emitted in declaration order; blank optional fields omitted.
 */
export function serializePartiesYaml(roles: TemplateRole[], bindings: PartyBindings): string {
	const lines: string[] = ['parties:'];

	const emitOpt = (indent: string, key: string, val: string | undefined) => {
		if (val && val.trim()) lines.push(`${indent}${key}: "${escapeYaml(val)}"`);
	};

	for (const role of roles) {
		const b = bindings[role.key];
		if (!b) continue;
		lines.push(`  ${role.key}:`);
		lines.push(`    signer_name: "${escapeYaml(b.signer_name)}"`);
		lines.push(`    wallet: "${b.wallet}"`);
		if (b.entity) {
			lines.push(`    entity:`);
			lines.push(`      legal_name: "${escapeYaml(b.entity.legal_name)}"`);
			emitOpt('      ', 'jurisdiction', b.entity.jurisdiction);
			emitOpt('      ', 'registration_number', b.entity.registration_number);
			emitOpt('      ', 'registered_address', b.entity.registered_address);
			emitOpt('      ', 'tax_id', b.entity.tax_id);
			emitOpt('      ', 'signer_role', b.entity.signer_role);
			emitOpt('      ', 'email', b.entity.email);
			emitOpt('      ', 'phone', b.entity.phone);
		} else {
			emitOpt('    ', 'email', b.email);
			emitOpt('    ', 'phone', b.phone);
			emitOpt('    ', 'address', b.address);
			emitOpt('    ', 'date_of_birth', b.date_of_birth);
			emitOpt('    ', 'nationality', b.nationality);
			emitOpt('    ', 'government_id', b.government_id);
			emitOpt('    ', 'tax_id', b.tax_id);
		}
	}
	return lines.join('\n');
}

function escapeYaml(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
