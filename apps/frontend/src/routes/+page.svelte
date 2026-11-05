<script lang="ts">
	import { onMount } from 'svelte';
	import { readContract } from '@wagmi/core';
	import { config } from '#lib/services/wallet-config.ts';
	import { daaRegistryConfig, daaRegistryAddress } from '#lib/contracts/index.ts';
	import { fetchFromArweave } from '#lib/services/arweave.ts';
	import ContentUriLink from '#lib/components/ContentUriLink.svelte';
	import { renderSectionedMarkdown } from '#lib/services/markdown.ts';
	import { loadCategories as fetchCategories, loadDocuments, loadAmendmentRestrictions } from '#lib/services/registry.ts';
	import Tooltip from '#lib/components/Tooltip.svelte';
	import { docTypeLabel, relationLabel, RELATION_AMENDS, RELATION_REVISES, RELATION_REPEALS, RELATION_CODIFIES, RELATION_GOVERNS } from '#lib/constants/docTypes.ts';
	import { hasVariableSchema } from '#lib/services/template-variables.ts';
	import { formatDate, stripFrontmatter } from '#lib/services/format.ts';
	import CiteButton from '#lib/components/CiteButton.svelte';
	import ExportCitationButton from '#lib/components/ExportCitationButton.svelte';
	import LegislationExpand from '#lib/components/LegislationExpand.svelte';

	interface Reference {
		registryAddress: string;
		chainId: number;
		categoryId: number;
		documentId: number;
		version: number;
		relationType: number;
		targetSection: string;
	}

	interface IncomingRef {
		fromVersion: number;
		relationType: number;
		targetSection: string;
	}

	interface Version {
		contentUri: string;
		contentHash: string;
		title: string;
		version: number;
		timestamp: number;
		voteId: string;
		docType: number;
		references: Reference[];
		refsLoaded: boolean;
		incomingRefs: IncomingRef[];
		rawMarkdown: string;
		htmlContent: string;
		fetching: boolean;
		fetched: boolean;
	}

	interface DocEntry {
		documentId: number;
		latestTitle: string;
		versionCount: number;
		versions: Version[];
		expanded: boolean;
		loading: boolean;
		restrictions?: {
			minTimeBetweenAmendments: number;
			lockedSections: number[];
		};
		hasVariables: boolean;
	}

	interface Category {
		id: number;
		name: string;
		documentCount: number;
		documents: DocEntry[];
		expanded: boolean;
		loading: boolean;
	}

	const categoryColors = [
		{ border: 'border-cat-blue', text: 'text-cat-blue', dot: 'bg-cat-blue' },
		{ border: 'border-cat-green', text: 'text-cat-green', dot: 'bg-cat-green' },
		{ border: 'border-cat-gold', text: 'text-cat-gold', dot: 'bg-cat-gold' }
	];

	const chainId = Number(import.meta.env.VITE_CHAIN_ID);

	let categories = $state<Category[]>([]);
	let loading = $state(true);
	let error = $state('');
	let selectedVersion = $state<{ categoryId: number; documentId: number; version: number } | null>(null);
	let copyLabel = $state('Copy');

	function getSelectedVersion(): Version | null {
		if (!selectedVersion) return null;
		const cat = categories.find(c => c.id === selectedVersion!.categoryId);
		const doc = cat?.documents.find(d => d.documentId === selectedVersion!.documentId);
		return doc?.versions.find(v => v.version === selectedVersion!.version) ?? null;
	}

	async function copyMarkdown() {
		const ver = getSelectedVersion();
		if (!ver) return;
		try {
			await navigator.clipboard.writeText(ver.rawMarkdown);
			copyLabel = 'Copied';
			setTimeout(() => copyLabel = 'Copy', 2000);
		} catch {
			copyLabel = 'Failed';
			setTimeout(() => copyLabel = 'Copy', 2000);
		}
	}

	function getColors(index: number) {
		return categoryColors[index % categoryColors.length];
	}


	async function loadCats() {
		try {
			const cats = await fetchCategories();
			categories = cats.map(c => ({
				...c,
				documents: [],
				expanded: false,
				loading: false
			}));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load registry';
		} finally {
			loading = false;
		}
	}

	async function toggleCategory(index: number) {
		const cat = categories[index];

		if (cat.expanded) {
			categories[index] = { ...cat, expanded: false };
			selectedVersion = null;
			return;
		}

		categories[index] = { ...cat, expanded: true, loading: true };

		if (cat.documentCount > 0 && cat.documents.length === 0) {
			try {
				const docs = await loadDocuments(cat.id);
				categories[index] = {
					...categories[index],
					documents: docs.map(d => ({
						documentId: d.documentId,
						latestTitle: d.latestTitle,
						versionCount: d.versionCount,
						versions: [],
						expanded: false,
						loading: false,
						hasVariables: false
					})),
					loading: false
				};
			} catch {
				categories[index] = { ...categories[index], loading: false };
			}
		} else {
			categories[index] = { ...categories[index], loading: false };
		}
	}

	async function toggleDocument(catIndex: number, docIndex: number) {
		const cat = categories[catIndex];
		const doc = cat.documents[docIndex];

		if (doc.expanded) {
			const updatedDocs = [...cat.documents];
			updatedDocs[docIndex] = { ...doc, expanded: false };
			categories[catIndex] = { ...cat, documents: updatedDocs };
			selectedVersion = null;
			return;
		}

		const updatedDocs = [...cat.documents];
		updatedDocs[docIndex] = { ...doc, expanded: true, loading: true };
		categories[catIndex] = { ...cat, documents: updatedDocs };

		if (doc.versionCount > 0 && doc.versions.length === 0) {
			try {
				const history = (await readContract(config, {
					...daaRegistryConfig,
					functionName: 'getHistory',
					args: [BigInt(cat.id), BigInt(doc.documentId)]
				})) as Array<{
					contentUri: string;
					contentHash: string;
					title: string;
					version: bigint;
					timestamp: bigint;
					voteId: string;
					docType: number;
				}>;

				const versions: Version[] = history.map((d) => ({
					contentUri: d.contentUri,
					contentHash: d.contentHash,
					title: d.title,
					version: Number(d.version),
					timestamp: Number(d.timestamp),
					voteId: d.voteId,
					docType: d.docType,
					references: [],
					refsLoaded: false,
					incomingRefs: [],
					rawMarkdown: '',
					htmlContent: '',
					fetching: false,
					fetched: false
				}));

				// Load restrictions in parallel
				let restrictions: DocEntry['restrictions'] | undefined;
				try {
					const r = await loadAmendmentRestrictions(cat.id, doc.documentId);
					if (r.minTimeBetweenAmendments > 0 || r.lockedSections.length > 0) {
						restrictions = {
							minTimeBetweenAmendments: r.minTimeBetweenAmendments,
							lockedSections: r.lockedSections
						};
					}
				} catch { /* no restrictions */ }

				const updatedDocs2 = [...categories[catIndex].documents];
				updatedDocs2[docIndex] = {
					...updatedDocs2[docIndex],
					versions,
					restrictions,
					loading: false
				};
				categories[catIndex] = { ...categories[catIndex], documents: updatedDocs2 };

				loadAllReferences(catIndex, docIndex);
			} catch {
				const updatedDocs2 = [...categories[catIndex].documents];
				updatedDocs2[docIndex] = { ...updatedDocs2[docIndex], loading: false };
				categories[catIndex] = { ...categories[catIndex], documents: updatedDocs2 };
			}
		} else {
			const updatedDocs2 = [...categories[catIndex].documents];
			updatedDocs2[docIndex] = { ...updatedDocs2[docIndex], loading: false };
			categories[catIndex] = { ...categories[catIndex], documents: updatedDocs2 };
		}
	}

	async function loadAllReferences(catIndex: number, docIndex: number) {
		const cat = categories[catIndex];
		const doc = cat.documents[docIndex];
		if (!doc || doc.versions.length === 0) return;

		try {
			const allRefs = await Promise.all(
				doc.versions.map((ver) =>
					readContract(config, {
						...daaRegistryConfig,
						functionName: 'getReferences',
						args: [BigInt(cat.id), BigInt(doc.documentId), BigInt(ver.version)]
					}).catch(() => [])
				)
			);

			const updatedVersions = doc.versions.map((ver, i) => {
				const refs = (allRefs[i] as Array<{
					registryAddress: string;
					chainId: bigint;
					categoryId: bigint;
					documentId: bigint;
					version: bigint;
					relationType: number;
					targetSection: string;
				}>);
				return {
					...ver,
					references: refs.map((r) => ({
						registryAddress: r.registryAddress,
						chainId: Number(r.chainId),
						categoryId: Number(r.categoryId),
						documentId: Number(r.documentId),
						version: Number(r.version),
						relationType: r.relationType,
						targetSection: r.targetSection
					})),
					refsLoaded: true
				};
			});

			for (const ver of updatedVersions) {
				for (const ref of ver.references) {
					// Only local, same-chain references contribute incoming-ref tags. An
					// external-registry ref with colliding local IDs must not render false
					// "Amended by" / "Repealed" tags on this document (N-4).
					if (
						ref.registryAddress.toLowerCase() !== daaRegistryAddress.toLowerCase() ||
						ref.chainId !== chainId ||
						ref.categoryId !== cat.id ||
						ref.documentId !== doc.documentId
					) continue;
					const target = updatedVersions.find((v) => v.version === ref.version);
					if (target) {
						target.incomingRefs = [
							...target.incomingRefs,
							{
								fromVersion: ver.version,
								relationType: ref.relationType,
								targetSection: ref.targetSection
							}
						];
					}
				}
			}

			const updatedDocs = [...categories[catIndex].documents];
			updatedDocs[docIndex] = { ...updatedDocs[docIndex], versions: updatedVersions };
			categories[catIndex] = { ...categories[catIndex], documents: updatedDocs };
		} catch {
			// References failed to load — versions still display without tags
		}
	}

	function isPartialRepeal(ver: Version): boolean {
		if (ver.docType !== 3) return false;
		return ver.references.some((r) => r.relationType === RELATION_REPEALS && r.targetSection.trim() !== '');
	}

	/** Compute display labels for versions: Originals/Revisions get version numbers, Amendments get amendment numbers */
	function computeDisplayLabels(versions: Version[]): Map<number, string> {
		const labels = new Map<number, string>();
		let currentVersion = 0;
		let amendmentCount = 0;

		for (const ver of versions) {
			if (ver.docType === 0 || ver.docType === 2) {
				// Original or Revision — increment display version
				currentVersion++;
				amendmentCount = 0;
				labels.set(ver.version, `v${currentVersion}`);
			} else if (ver.docType === 1) {
				// Amendment — sub-label under current version
				amendmentCount++;
				labels.set(ver.version, `Amendment ${amendmentCount}`);
			} else if (ver.docType === 3) {
				// Repeal — distinguish partial from full based on outgoing ref's targetSection
				labels.set(ver.version, isPartialRepeal(ver) ? 'Partial Repeal' : 'Repeal');
			} else if (ver.docType === 4) {
				// Codification — shouldn't appear here (new doc), but handle gracefully
				currentVersion++;
				amendmentCount = 0;
				labels.set(ver.version, `v${currentVersion} (Codified)`);
			} else {
				labels.set(ver.version, `v${ver.version}`);
			}
		}
		return labels;
	}

	/** Get the document's canonical title (from the first Original entry) */
	function getDocumentTitle(doc: DocEntry): string {
		if (doc.versions.length > 0) {
			const original = doc.versions.find(v => v.docType === 0);
			if (original) return original.title;
			return doc.versions[0].title;
		}
		return doc.latestTitle;
	}

	function getRefDocTitle(ref: Reference): string {
		// Foreign-registry refs must not resolve against local titles — surface them
		// as external instead of mislabelling them with a same-ID local document (N-4).
		if (ref.registryAddress.toLowerCase() !== daaRegistryAddress.toLowerCase()) {
			return `doc ${ref.documentId} (external registry)`;
		}
		const cat = categories.find(c => c.id === ref.categoryId);
		const doc = cat?.documents.find(d => d.documentId === ref.documentId);
		return doc?.latestTitle ?? `doc ${ref.documentId}`;
	}

	function isSuperseded(ver: Version): boolean {
		return ver.incomingRefs.some(
			(r) => (r.relationType === RELATION_REPEALS && !r.targetSection) ||
				r.relationType === RELATION_REVISES
		);
	}

	function incomingRefLabel(ref: IncomingRef, displayLabels: Map<number, string>): string {
		const label = displayLabels.get(ref.fromVersion) ?? `v${ref.fromVersion}`;
		if (ref.relationType === RELATION_AMENDS) {
			return ref.targetSection ? `\u00A7${ref.targetSection} amended by ${label}` : `Amended by ${label}`;
		}
		if (ref.relationType === RELATION_REPEALS) {
			if (ref.targetSection) return `\u00A7${ref.targetSection} repealed`;
			return 'Repealed';
		}
		if (ref.relationType === RELATION_REVISES) {
			return `Replaced by ${label}`;
		}
		if (ref.relationType === RELATION_CODIFIES) {
			return `Codified in ${label}`;
		}
		return `Referenced by ${label}`;
	}

	function findVersion(categoryId: number, documentId: number, version: number): { catIdx: number; docIdx: number; verIdx: number } | null {
		const catIdx = categories.findIndex(c => c.id === categoryId);
		if (catIdx === -1) return null;
		const docIdx = categories[catIdx].documents.findIndex(d => d.documentId === documentId);
		if (docIdx === -1) return null;
		const verIdx = categories[catIdx].documents[docIdx].versions.findIndex(v => v.version === version);
		if (verIdx === -1) return null;
		return { catIdx, docIdx, verIdx };
	}

	async function viewVersion(categoryId: number, documentId: number, version: number) {
		if (selectedVersion?.categoryId === categoryId && selectedVersion?.documentId === documentId && selectedVersion?.version === version) {
			selectedVersion = null;
			copyLabel = 'Copy';
			return;
		}

		selectedVersion = { categoryId, documentId, version };
		copyLabel = 'Copy';

		const loc = findVersion(categoryId, documentId, version);
		if (!loc) return;
		const ver = categories[loc.catIdx].documents[loc.docIdx].versions[loc.verIdx];

		if (ver.fetched || ver.fetching) return;

		const updatedVersions = [...categories[loc.catIdx].documents[loc.docIdx].versions];
		updatedVersions[loc.verIdx] = { ...ver, fetching: true };
		const updatedDocs = [...categories[loc.catIdx].documents];
		updatedDocs[loc.docIdx] = { ...updatedDocs[loc.docIdx], versions: updatedVersions };
		categories[loc.catIdx] = { ...categories[loc.catIdx], documents: updatedDocs };

		try {
			const text = await fetchFromArweave(ver.contentUri, ver.contentHash);
			const body = stripFrontmatter(text);
			const html = await renderSectionedMarkdown(body, ver.contentHash);

			const current = findVersion(categoryId, documentId, version);
			if (current) {
				const uv = [...categories[current.catIdx].documents[current.docIdx].versions];
				uv[current.verIdx] = { ...uv[current.verIdx], rawMarkdown: body, htmlContent: html, fetching: false, fetched: true };
				const ud = [...categories[current.catIdx].documents];
				const docHasVars = ud[current.docIdx].hasVariables || hasVariableSchema(text);
				ud[current.docIdx] = { ...ud[current.docIdx], versions: uv, hasVariables: docHasVars };
				categories[current.catIdx] = { ...categories[current.catIdx], documents: ud };
			}
		} catch {
			const current = findVersion(categoryId, documentId, version);
			if (current) {
				const uv = [...categories[current.catIdx].documents[current.docIdx].versions];
				uv[current.verIdx] = {
					...uv[current.verIdx],
					htmlContent: '<p class="text-text-muted">Content unavailable. The document may still be confirming on the Arweave network \u2014 this can take up to 30 minutes after upload. Try again shortly.</p>',
					fetching: false,
					fetched: true
				};
				const ud = [...categories[current.catIdx].documents];
				ud[current.docIdx] = { ...ud[current.docIdx], versions: uv };
				categories[current.catIdx] = { ...categories[current.catIdx], documents: ud };
			}
		}
	}

	onMount(loadCats);
</script>

<div>
	<h1 class="text-2xl font-semibold mb-6">Decentralized Autonomous Association — Registry <Tooltip text={"The DAA stores an organization's legal documents as permanent, immutable files on Arweave decentralized data storage.\n\nBoth the document's content hash (SHA-256) and Arweave transaction ID are then recorded in a Solidity smart contract on Ethereum, creating a tamper-proof registry.\n\nThe on-chain record includes structured metadata (title, category, version, vote reference), making the entire registry machine-readable and verifiable by any application or contract."} align="left"><span class="text-sm font-normal text-text-muted cursor-help">(?)</span></Tooltip></h1>

	{#if loading}
		<p class="text-text-secondary">Loading categories...</p>
	{:else if error}
		<p class="text-error">{error}</p>
	{:else if categories.length === 0}
		<p class="text-text-secondary">No categories found.</p>
	{:else}
		<div class="flex flex-col gap-4">
			{#each categories as cat, i}
				{@const colors = getColors(i)}
				<div class="border {colors.border} border-opacity-40 rounded-lg bg-bg-light">
					<button
						onclick={() => toggleCategory(i)}
						class="w-full flex items-center justify-between px-5 py-4 cursor-pointer"
					>
						<div class="flex items-center gap-3">
							<span class="w-2.5 h-2.5 rounded-full {colors.dot}"></span>
							<span class="font-medium {colors.text}">{cat.name}</span>
						</div>
						<div class="flex items-center gap-3">
							<span class="text-sm text-text-muted">
								{cat.documentCount}
								{cat.documentCount === 1 ? 'document' : 'documents'}
							</span>
							<span
								class="text-text-muted text-xs transition-transform {cat.expanded
									? 'rotate-180'
									: ''}"
							>
								&#9660;
							</span>
						</div>
					</button>

					{#if cat.expanded}
						<div class="border-t border-border px-5 py-4">
							{#if cat.loading}
								<p class="text-text-secondary text-sm">Loading documents...</p>
							{:else if cat.documentCount === 0}
								<p class="text-text-muted text-sm">No documents recorded yet.</p>
							{:else}
								<div class="flex flex-col gap-2">
									{#each cat.documents as doc, di}
										<div>
											<button
												onclick={() => toggleDocument(i, di)}
												class="w-full text-left px-3 py-2 rounded transition-colors cursor-pointer hover:bg-bg-lighter flex items-center justify-between"
											>
												<div class="flex items-center gap-3">
													<span class="text-xs text-text-muted font-mono w-5 text-right shrink-0">{doc.documentId}.</span>
													<span class="text-sm font-medium">{doc.versions.length > 0 ? getDocumentTitle(doc) : doc.latestTitle}</span>
													{#if doc.hasVariables}
														<span class="text-xs px-1.5 py-0.5 rounded bg-primary/20 text-primary">Contract Template</span>
													{/if}
													{#if doc.restrictions}
														{@const isEntire = doc.restrictions.lockedSections.includes(0)}
														<span class="text-xs text-cat-gold" title="{isEntire ? 'Entire document locked' : doc.restrictions.lockedSections.length > 0 ? '\u00A7' + doc.restrictions.lockedSections.join(', \u00A7') + ' locked' : ''}{doc.restrictions.minTimeBetweenAmendments > 0 ? (doc.restrictions.lockedSections.length > 0 || isEntire ? ', ' : '') + Math.round(doc.restrictions.minTimeBetweenAmendments / 86400) + '-day lockdown' : isEntire ? ', permanent' : ''}">{isEntire ? 'Restricted' : 'Partially restricted'}</span>
													{/if}
												</div>
												<div class="flex items-center gap-3">
													<span class="text-xs text-text-muted">
														{#if doc.versions.length > 0}
															{@const vCount = doc.versions.filter(v => v.docType === 0 || v.docType === 2).length}
															{@const aCount = doc.versions.filter(v => v.docType === 1).length}
															{@const rCount = doc.versions.filter(v => v.docType === 3).length}
															v{vCount}{#if aCount > 0}, {aCount} {aCount === 1 ? 'amendment' : 'amendments'}{/if}{#if rCount > 0}, {rCount} {rCount === 1 ? 'repeal' : 'repeals'}{/if}
														{:else}
															{doc.versionCount} {doc.versionCount === 1 ? 'entry' : 'entries'}
														{/if}
													</span>
													<span class="text-text-muted text-xs transition-transform {doc.expanded ? 'rotate-180' : ''}">&#9660;</span>
												</div>
											</button>

											{#if doc.expanded}
												<div class="ml-8 mt-1 mb-2 border-l border-border pl-4">
													{#if doc.loading}
														<p class="text-text-secondary text-sm py-1">Loading versions...</p>
													{:else}
														{@const displayLabels = computeDisplayLabels(doc.versions)}
													{#each doc.versions as ver}
															{@const isSelected =
																selectedVersion?.categoryId === cat.id &&
																selectedVersion?.documentId === doc.documentId &&
																selectedVersion?.version === ver.version}
														{@const displayLabel = displayLabels.get(ver.version) ?? `v${ver.version}`}
															<div>
																<button
																	onclick={() => viewVersion(cat.id, doc.documentId, ver.version)}
																	class="w-full text-left px-3 py-2 rounded transition-colors cursor-pointer
																	{isSelected ? 'bg-bg-lighter' : 'hover:bg-bg-lighter'}"
																>
																	<div class="flex items-center justify-between">
																		<div class="flex items-center gap-3 flex-wrap">
																			<span class="text-xs text-text-muted font-mono shrink-0">{displayLabel}</span>
																			{#if ver.docType === 0 || ver.docType === 2}
																				<span class="text-sm {isSuperseded(ver) ? 'line-through text-text-muted' : ''}">{ver.title}</span>
																			{/if}
																			{#if ver.docType !== 0}
																				<span class="text-xs px-1.5 py-0.5 rounded bg-bg-lighter text-text-muted">{isPartialRepeal(ver) ? `Repealed \u00A7${ver.references.find((r) => r.relationType === RELATION_REPEALS)?.targetSection.split(',').join(', \u00A7')}` : docTypeLabel(ver.docType)}</span>
																			{/if}
																			{#each ver.incomingRefs as iref}
																				<span class="text-xs px-1.5 py-0.5 rounded bg-bg-lighter text-text-secondary">{incomingRefLabel(iref, displayLabels)}</span>
																			{/each}
																		</div>
																		<span class="text-xs text-text-muted">
																			Ratified {formatDate(ver.timestamp)}
																		</span>
																	</div>
																</button>

																{#if isSelected}
																	<div class="mt-2 mb-2 mx-3 p-4 rounded bg-bg border border-border">
																		{#if ver.fetching}
																			<p class="text-text-secondary text-sm">
																				Loading document from permanent storage... This may take a moment (sometimes several minutes).
																			</p>
																		{:else if ver.fetched}
																			{#if ver.references.length > 0}
																				<div class="mb-3 pb-3 border-b border-border">
																					<span class="text-xs text-text-muted">References:</span>
																					{#each ver.references as ref}
																						<span class="text-xs ml-2">
																							{relationLabel(ref.relationType)} {getRefDocTitle(ref)}, v{ref.version}{#if ref.targetSection}, {'\u00A7'}{ref.targetSection}{/if}
																						</span>
																					{/each}
																				</div>
																			{/if}
																			<div class="doc-viewer prose prose-invert max-w-none text-sm">
																				{@html ver.htmlContent}
																			</div>
																			<div class="mt-3 pt-3 border-t border-border flex items-center justify-between">
																				<span class="text-xs text-text-muted">Content URI: <ContentUriLink uri={ver.contentUri} /></span>
																				<div class="flex items-center gap-2">
																					<CiteButton
																						title={ver.title}
																						version={ver.version}
																						contentHash={ver.contentHash}
																						timestamp={ver.timestamp}
																						registryAddress={daaRegistryAddress}
																						chainId={chainId}
																						categoryId={cat.id}
																						documentId={doc.documentId}
																						categoryName={cat.name}
																					/>
																					<ExportCitationButton
																						title={ver.title}
																						version={ver.version}
																						contentHash={ver.contentHash}
																						contentUri={ver.contentUri}
																						timestamp={ver.timestamp}
																						registryAddress={daaRegistryAddress}
																						chainId={chainId}
																						categoryId={cat.id}
																						documentId={doc.documentId}
																						categoryName={cat.name}
																					/>
																					<button
																						onclick={copyMarkdown}
																						class="text-xs px-3 py-1 rounded border border-border hover:bg-bg-lighter text-text-muted hover:text-text transition-colors cursor-pointer"
																					>
																						{copyLabel}
																					</button>
																				</div>
																			</div>
																		{:else}
																			<p class="text-text-secondary text-sm">
																				Loading document from permanent storage... This may take a moment (sometimes several minutes).
																			</p>
																		{/if}
																	</div>
																{/if}
															</div>
														{/each}
														{#if !doc.hasVariables && doc.versions.length > 0}
															<div class="mt-2">
																<LegislationExpand
																	reference={{
																		registryAddress: daaRegistryAddress,
																		chainId: BigInt(chainId),
																		categoryId: BigInt(cat.id),
																		documentId: BigInt(doc.documentId),
																		version: BigInt(doc.versions[doc.versions.length - 1].version),
																		relationType: RELATION_GOVERNS,
																		targetSection: ''
																	}}
																	asOf={BigInt(Math.floor(Date.now() / 1000))}
																	pickDate
																	categoryName={cat.name}
																/>
															</div>
														{/if}
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
