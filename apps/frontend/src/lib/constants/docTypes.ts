import {
	RELATION_AMENDS,
	RELATION_REVISES,
	RELATION_REPEALS,
	RELATION_CODIFIES,
	RELATION_GOVERNS,
	RELATION_IMPLEMENTS,
	RELATION_REFERENCES,
	RELATION_TEMPLATE,
	DOC_TYPE_ORIGINAL,
	DOC_TYPE_AMENDMENT,
	DOC_TYPE_REVISION,
	DOC_TYPE_REPEAL,
	DOC_TYPE_CODIFICATION
} from '@vattelum/document-registry-js';

export const DOC_TYPES = [
	{ value: DOC_TYPE_ORIGINAL, label: 'Original', description: 'New legislation' },
	{ value: DOC_TYPE_AMENDMENT, label: 'Amendment', description: 'Modifies an existing document' },
	{ value: DOC_TYPE_REVISION, label: 'Revision', description: 'Full replacement of an existing document' },
	{ value: DOC_TYPE_REPEAL, label: 'Repeal', description: 'Revokes an existing document' },
	{ value: DOC_TYPE_CODIFICATION, label: 'Codification', description: 'Consolidates multiple documents' }
] as const;

/** Maps docType → the relationType used in DocumentReference */
export const DOC_TYPE_TO_RELATION: Record<number, number> = {
	[DOC_TYPE_AMENDMENT]: RELATION_AMENDS,
	[DOC_TYPE_REVISION]: RELATION_REVISES,
	[DOC_TYPE_REPEAL]: RELATION_REPEALS,
	[DOC_TYPE_CODIFICATION]: RELATION_CODIFIES
};

export const RELATION_LABELS: Record<number, string> = {
	[RELATION_AMENDS]: 'Amends',
	[RELATION_REVISES]: 'Revises',
	[RELATION_REPEALS]: 'Repeals',
	[RELATION_CODIFIES]: 'Codifies',
	[RELATION_GOVERNS]: 'Governing Law',
	[RELATION_IMPLEMENTS]: 'Adopted Module',
	[RELATION_REFERENCES]: 'Reference',
	[RELATION_TEMPLATE]: 'Template'
};

export function docTypeLabel(docType: number): string {
	return DOC_TYPES.find((d) => d.value === docType)?.label ?? `Type ${docType}`;
}

export function relationLabel(relationType: number): string {
	return RELATION_LABELS[relationType] ?? `Relation ${relationType}`;
}

/** Whether a docType requires selecting referenced documents */
export function requiresReferences(docType: number): boolean {
	return docType >= DOC_TYPE_AMENDMENT && docType <= DOC_TYPE_CODIFICATION;
}

/** Whether a docType allows selecting multiple references (only Codification) */
export function allowsMultipleReferences(docType: number): boolean {
	return docType === DOC_TYPE_CODIFICATION;
}

/** Whether a docType supports section-level targeting (Amendment, Repeal) */
export function supportsSectionTargeting(docType: number): boolean {
	return docType === DOC_TYPE_AMENDMENT || docType === DOC_TYPE_REPEAL;
}

export {
	RELATION_AMENDS,
	RELATION_REVISES,
	RELATION_REPEALS,
	RELATION_CODIFIES,
	RELATION_GOVERNS,
	RELATION_IMPLEMENTS,
	RELATION_REFERENCES,
	RELATION_TEMPLATE,
	DOC_TYPE_ORIGINAL,
	DOC_TYPE_AMENDMENT,
	DOC_TYPE_REVISION,
	DOC_TYPE_REPEAL,
	DOC_TYPE_CODIFICATION
};
