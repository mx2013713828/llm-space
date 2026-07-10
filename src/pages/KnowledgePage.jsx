import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../lib/apiClient.js';
import {
	buildKnowledgeFilePayload,
	formatKnowledgeFileSize,
	getKnowledgeBaseStatusSummary,
	isSupportedKnowledgeFile,
	normalizeKnowledgeBaseSummary,
	normalizeRetrievalSettings,
} from '../lib/knowledgeBases.js';
import { parseFeatures } from '../lib/FeatureSchema.js';
import {
	KNOWLEDGE_RUNTIME_STRATEGIES,
	applyKnowledgeRuntimeStrategy,
	getKnowledgeStrategySummary,
	resolveKnowledgeRuntime,
} from '../lib/knowledgeRuntime.js';

const DEFAULT_SETTINGS = {
	chunkSize: 1000,
	overlap: 150,
};

const ACCEPTED_KNOWLEDGE_FILE_TYPES = [
	'.md',
	'.markdown',
	'.txt',
	'.json',
	'.csv',
	'.pdf',
	'.docx',
	'text/markdown',
	'text/plain',
	'text/csv',
	'application/json',
	'application/pdf',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',');

function compactSnippet(text = '', maxLength = 320) {
	const compact = String(text || '').replace(/\s+/g, ' ').trim();
	return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function formatDate(value) {
	if (!value) return 'Never';
	try {
		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		}).format(new Date(value));
	} catch {
		return String(value);
	}
}

async function readFileAsBase64(file) {
	const buffer = await file.arrayBuffer();
	let binary = '';
	const bytes = new Uint8Array(buffer);
	const batchSize = 0x8000;
	for (let index = 0; index < bytes.length; index += batchSize) {
		binary += String.fromCharCode(...bytes.subarray(index, index + batchSize));
	}
	return btoa(binary);
}

function Metric({ label, value }) {
	return (
		<div className="knowledge-metric">
			<div className="knowledge-metric-value" title={String(value ?? '')}>{value}</div>
			<div className="knowledge-metric-label">{label}</div>
		</div>
	);
}

function EmptyPanel({ title, body }) {
	return (
		<div className="knowledge-empty">
			<div className="knowledge-empty-mark">KB</div>
			<div className="knowledge-empty-title">{title}</div>
			<div className="knowledge-empty-body">{body}</div>
		</div>
	);
}

export function KnowledgePage({ harness, onSave }) {
	const [knowledgeBases, setKnowledgeBases] = useState([]);
	const [selectedId, setSelectedId] = useState('');
	const [files, setFiles] = useState([]);
	const [retrievalRecords, setRetrievalRecords] = useState([]);
	const [newName, setNewName] = useState('');
	const [newDescription, setNewDescription] = useState('');
	const [settings, setSettings] = useState(DEFAULT_SETTINGS);
	const [selectedFile, setSelectedFile] = useState(null);
	const [query, setQuery] = useState('');
	const [retrieval, setRetrieval] = useState(null);
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');
	const [hasLoadedBases, setHasLoadedBases] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [isIndexing, setIsIndexing] = useState(false);
	const [runtimeDraft, setRuntimeDraft] = useState(null);
	const [baseRetrievalDraft, setBaseRetrievalDraft] = useState(null);

	const bases = useMemo(() => knowledgeBases.map(normalizeKnowledgeBaseSummary), [knowledgeBases]);
	const selectedBase = bases.find(base => base.id === selectedId) || null;
	const selectedRawBase = knowledgeBases.find(base => base.id === selectedBase?.id) || null;
	const parsedFeatures = useMemo(() => parseFeatures(harness?.features || {}), [harness?.features]);
	const knowledgeRuntime = useMemo(() => resolveKnowledgeRuntime(parsedFeatures), [parsedFeatures]);
	const strategySummary = getKnowledgeStrategySummary(knowledgeRuntime.strategy);

	useEffect(() => {
		setRuntimeDraft({
			topK: knowledgeRuntime.topK,
			maxChars: knowledgeRuntime.maxChars,
			scoreThreshold: knowledgeRuntime.scoreThreshold,
		});
	}, [knowledgeRuntime.topK, knowledgeRuntime.maxChars, knowledgeRuntime.scoreThreshold]);

	useEffect(() => {
		if (!selectedBase) {
			setBaseRetrievalDraft(null);
			return;
		}
		setBaseRetrievalDraft(normalizeRetrievalSettings(selectedBase.settings || selectedRawBase?.settings || {}));
	}, [selectedBase?.id, selectedRawBase?.settings]);

	const loadBases = useCallback(async () => {
		setIsLoading(true);
		setError('');
		try {
			const res = await apiFetch('/api/knowledge-bases');
			if (!res.ok) throw new Error(`Failed to load knowledge bases (${res.status})`);
			const data = await res.json();
			setKnowledgeBases(Array.isArray(data) ? data : []);
			setSelectedId(current => data?.some?.(base => base.id === current) ? current : '');
		} catch (err) {
			setError(err.message || 'Failed to load knowledge bases.');
		} finally {
			setHasLoadedBases(true);
			setIsLoading(false);
		}
	}, []);

	const loadFiles = useCallback(async (knowledgeBaseId) => {
		if (!knowledgeBaseId) {
			setFiles([]);
			return;
		}
		try {
			const res = await apiFetch(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/files`);
			if (!res.ok) throw new Error(`Failed to load files (${res.status})`);
			const data = await res.json();
			setFiles(Array.isArray(data) ? data : []);
		} catch (err) {
			setFiles([]);
			setError(err.message || 'Failed to load files.');
		}
	}, []);

	const loadRetrievalRecords = useCallback(async (knowledgeBaseId) => {
		if (!knowledgeBaseId) {
			setRetrievalRecords([]);
			return;
		}
		try {
			const res = await apiFetch(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/retrieval-records`);
			if (!res.ok) throw new Error(`Failed to load retrieval records (${res.status})`);
			const data = await res.json();
			setRetrievalRecords(Array.isArray(data) ? data : []);
		} catch (err) {
			setRetrievalRecords([]);
			setError(err.message || 'Failed to load retrieval records.');
		}
	}, []);

	useEffect(() => {
		void Promise.resolve().then(loadBases);
	}, [loadBases]);

	useEffect(() => {
		void Promise.resolve().then(() => loadFiles(selectedBase?.id));
	}, [loadFiles, selectedBase?.id]);

	useEffect(() => {
		void Promise.resolve().then(() => loadRetrievalRecords(selectedBase?.id));
	}, [loadRetrievalRecords, selectedBase?.id]);

	async function createKnowledgeBase() {
		const name = newName.trim();
		if (!name) {
			setError('Knowledge base name is required.');
			return;
		}
		setIsLoading(true);
		setError('');
		try {
			const res = await apiFetch('/api/knowledge-bases', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name,
					description: newDescription.trim(),
					settings,
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error || `Create failed (${res.status})`);
			const created = await res.json();
			setKnowledgeBases(prev => [...prev, created]);
			setSelectedId(created.id);
			setNewName('');
			setNewDescription('');
			setShowCreateForm(false);
			setStatus(`Created ${created.name}.`);
		} catch (err) {
			setError(err.message || 'Failed to create knowledge base.');
		} finally {
			setIsLoading(false);
		}
	}

	async function saveKnowledgeFeatures(nextFeatures, successMessage) {
		if (!harness?.id || !onSave) {
			setError('Select a harness before changing knowledge runtime settings.');
			return;
		}
		setIsLoading(true);
		setError('');
		try {
			await onSave({
				...harness,
				features: nextFeatures,
			});
			setStatus(successMessage);
		} catch (err) {
			setError(err.message || 'Failed to save knowledge runtime settings.');
		} finally {
			setIsLoading(false);
		}
	}

	async function changeKnowledgeStrategy(strategyId) {
		const nextFeatures = applyKnowledgeRuntimeStrategy(harness?.features || {}, strategyId);
		await saveKnowledgeFeatures(nextFeatures, `Knowledge runtime set to ${KNOWLEDGE_RUNTIME_STRATEGIES[strategyId]?.name || strategyId}.`);
	}

	async function applyRuntimeBounds() {
		const draft = runtimeDraft || {};
		const nextFeatures = {
			...(harness?.features || {}),
			knowledge_bases: {
				...(parsedFeatures.knowledge_bases || {}),
				topK: Number(draft.topK) || knowledgeRuntime.topK,
				maxChars: Number(draft.maxChars) || knowledgeRuntime.maxChars,
				scoreThreshold: Number(draft.scoreThreshold) || 0,
			},
		};
		await saveKnowledgeFeatures(nextFeatures, 'Knowledge retrieval bounds updated.');
	}

	async function deleteKnowledgeBase() {
		if (!selectedBase) return;
		if (!confirm(`Delete Knowledge Base "${selectedBase.name}"? This removes indexed files and chunks.`)) return;
		setIsLoading(true);
		setError('');
		try {
			const res = await apiFetch(`/api/knowledge-bases/${encodeURIComponent(selectedBase.id)}`, { method: 'DELETE' });
			if (!res.ok) throw new Error((await res.json()).error || `Delete failed (${res.status})`);
			setKnowledgeBases(prev => prev.filter(base => base.id !== selectedBase.id));
			setSelectedId('');
			setFiles([]);
			setRetrieval(null);
			setStatus(`Deleted ${selectedBase.name}.`);
		} catch (err) {
			setError(err.message || 'Failed to delete knowledge base.');
		} finally {
			setIsLoading(false);
		}
	}

	async function saveBaseRetrievalSettings() {
		if (!selectedBase || !baseRetrievalDraft) return;
		setIsLoading(true);
		setError('');
		try {
			const res = await apiFetch(`/api/knowledge-bases/${encodeURIComponent(selectedBase.id)}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					settings: {
						...(selectedRawBase?.settings || {}),
						topK: Number(baseRetrievalDraft.topK) || 5,
						maxChars: Number(baseRetrievalDraft.maxChars) || 8000,
						scoreThreshold: Number(baseRetrievalDraft.scoreThreshold) || 0,
						indexMethod: baseRetrievalDraft.indexMethod || 'keyword',
						retrievalStrategy: baseRetrievalDraft.retrievalStrategy || 'keyword',
						embeddingProvider: baseRetrievalDraft.embeddingProvider || 'none',
						embeddingModel: baseRetrievalDraft.embeddingModel || '',
						embeddingDimensions: Number(baseRetrievalDraft.embeddingDimensions) || 0,
						embeddingBaseUrl: baseRetrievalDraft.embeddingBaseUrl || '',
						embeddingApiKeyEnv: baseRetrievalDraft.embeddingApiKeyEnv || '',
						vectorStore: baseRetrievalDraft.vectorStore || 'local_json',
						qdrantUrl: baseRetrievalDraft.qdrantUrl || 'http://localhost:6333',
						qdrantCollection: baseRetrievalDraft.qdrantCollection || '',
						qdrantApiKeyEnv: baseRetrievalDraft.qdrantApiKeyEnv || '',
						rerankProvider: baseRetrievalDraft.rerankProvider || 'none',
						rerankModel: baseRetrievalDraft.rerankModel || '',
						rerankBaseUrl: baseRetrievalDraft.rerankBaseUrl || '',
						rerankApiKeyEnv: baseRetrievalDraft.rerankApiKeyEnv || '',
						rerankTopN: Number(baseRetrievalDraft.rerankTopN) || 0,
						rerankInstruct: baseRetrievalDraft.rerankInstruct || '',
					},
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error || `Settings update failed (${res.status})`);
			const updated = await res.json();
			setKnowledgeBases(prev => prev.map(base => base.id === updated.id ? updated : base));
			setStatus('Retrieval quality settings saved.');
		} catch (err) {
			setError(err.message || 'Failed to save retrieval settings.');
		} finally {
			setIsLoading(false);
		}
	}

	async function uploadFile() {
		if (!selectedBase || !selectedFile) return;
		if (!isSupportedKnowledgeFile(selectedFile.name)) {
			setError('Only .md, .markdown, .txt, .json, .csv, .pdf, and .docx files are supported.');
			return;
		}
		setIsIndexing(true);
		setError('');
		try {
			const contentBase64 = await readFileAsBase64(selectedFile);
			const payload = buildKnowledgeFilePayload({
				file: selectedFile,
				contentBase64,
				settings: {
					...settings,
					embeddingProvider: baseRetrievalDraft?.embeddingProvider || selectedBase.settings?.embeddingProvider || 'none',
					embeddingModel: baseRetrievalDraft?.embeddingModel || selectedBase.settings?.embeddingModel || '',
					embeddingDimensions: baseRetrievalDraft?.embeddingDimensions || selectedBase.settings?.embeddingDimensions || 0,
					embeddingBaseUrl: baseRetrievalDraft?.embeddingBaseUrl || selectedBase.settings?.embeddingBaseUrl || '',
					embeddingApiKeyEnv: baseRetrievalDraft?.embeddingApiKeyEnv || selectedBase.settings?.embeddingApiKeyEnv || '',
					indexMethod: baseRetrievalDraft?.indexMethod || selectedBase.settings?.indexMethod || 'keyword',
					retrievalStrategy: baseRetrievalDraft?.retrievalStrategy || selectedBase.settings?.retrievalStrategy || 'keyword',
					vectorStore: baseRetrievalDraft?.vectorStore || selectedBase.settings?.vectorStore || 'local_json',
					qdrantUrl: baseRetrievalDraft?.qdrantUrl || selectedBase.settings?.qdrantUrl || 'http://localhost:6333',
					qdrantCollection: baseRetrievalDraft?.qdrantCollection || selectedBase.settings?.qdrantCollection || '',
					qdrantApiKeyEnv: baseRetrievalDraft?.qdrantApiKeyEnv || selectedBase.settings?.qdrantApiKeyEnv || '',
					rerankProvider: baseRetrievalDraft?.rerankProvider || selectedBase.settings?.rerankProvider || 'none',
					rerankModel: baseRetrievalDraft?.rerankModel || selectedBase.settings?.rerankModel || '',
					rerankBaseUrl: baseRetrievalDraft?.rerankBaseUrl || selectedBase.settings?.rerankBaseUrl || '',
					rerankApiKeyEnv: baseRetrievalDraft?.rerankApiKeyEnv || selectedBase.settings?.rerankApiKeyEnv || '',
					rerankTopN: baseRetrievalDraft?.rerankTopN || selectedBase.settings?.rerankTopN || 0,
					rerankInstruct: baseRetrievalDraft?.rerankInstruct || selectedBase.settings?.rerankInstruct || '',
				},
			});
			const res = await apiFetch(`/api/knowledge-bases/${encodeURIComponent(selectedBase.id)}/files`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
			if (!res.ok) throw new Error((await res.json()).error || `Upload failed (${res.status})`);
			const result = await res.json();
			setKnowledgeBases(prev => prev.map(base => base.id === result.knowledgeBase.id ? result.knowledgeBase : base));
			setSelectedFile(null);
			await loadFiles(selectedBase.id);
			const indexedChunkCount = Number(result.chunkCount ?? result.chunks?.length ?? 0);
			setStatus(`Indexed ${result.file.filename}: ${indexedChunkCount} chunks.`);
		} catch (err) {
			setError(err.message || 'Failed to index file.');
		} finally {
			setIsIndexing(false);
		}
	}

	async function testRetrieval() {
		if (!selectedBase || !query.trim()) return;
		setIsLoading(true);
		setError('');
		try {
			const res = await apiFetch('/api/knowledge-bases/retrieve', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					knowledgeBaseIds: [selectedBase.id],
					query,
					topK: baseRetrievalDraft?.topK || selectedBase.settings?.topK || 5,
					maxChars: baseRetrievalDraft?.maxChars || selectedBase.settings?.maxChars || 4000,
					scoreThreshold: baseRetrievalDraft?.scoreThreshold || selectedBase.settings?.scoreThreshold || 0,
					strategy: baseRetrievalDraft?.retrievalStrategy || selectedBase.settings?.retrievalStrategy || 'keyword',
					rerank: (baseRetrievalDraft?.rerankProvider || selectedBase.settings?.rerankProvider || 'none') !== 'none',
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error || `Retrieve failed (${res.status})`);
			setRetrieval(await res.json());
			await loadRetrievalRecords(selectedBase.id);
			setStatus('Retrieval preview updated.');
		} catch (err) {
			setError(err.message || 'Failed to retrieve knowledge.');
		} finally {
			setIsLoading(false);
		}
	}

	async function testEmbeddingSettings() {
		if (!baseRetrievalDraft) return;
		setIsLoading(true);
		setError('');
		try {
			const res = await apiFetch('/api/knowledge-bases/test-embedding', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					text: 'LLM Space embedding test',
					settings: {
						...(selectedRawBase?.settings || {}),
						...baseRetrievalDraft,
					},
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error || `Embedding test failed (${res.status})`);
			const result = await res.json();
			setStatus(`Embedding OK: ${result.embeddingProvider} / ${result.embeddingModel || 'none'} (${result.vectorDimensions} dims).`);
		} catch (err) {
			setError(err.message || 'Failed to test embedding settings.');
		} finally {
			setIsLoading(false);
		}
	}

	async function testRerankSettings() {
		if (!baseRetrievalDraft) return;
		setIsLoading(true);
		setError('');
		try {
			const res = await apiFetch('/api/knowledge-bases/test-rerank', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: 'What is LLM Space?',
					settings: {
						...(selectedRawBase?.settings || {}),
						...baseRetrievalDraft,
					},
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error || `Rerank test failed (${res.status})`);
			const result = await res.json();
			setStatus(`Rerank OK: ${result.rerankProvider} / ${result.rerankModel || 'none'} (top score ${Number(result.topScore || 0).toFixed(3)}).`);
		} catch (err) {
			setError(err.message || 'Failed to test rerank settings.');
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<div className="knowledge-page">
			<section className="knowledge-hero">
				<div>
					<div className="knowledge-eyebrow">Local RAG Workspace</div>
					<h1>Knowledge Bases</h1>
					<p>Keep local knowledge organized as mountable resources. Open a base to inspect files, settings, and retrieval behavior.</p>
				</div>
				<div className="knowledge-hero-stats">
					<Metric label="bases" value={bases.length} />
					<Metric label="current harness" value={harness?.name || '-'} />
					<Metric label="formats" value="MD TXT JSON CSV PDF DOCX" />
				</div>
			</section>

			<section className="knowledge-runtime-panel">
				<div className="knowledge-runtime-copy">
					<div className="knowledge-panel-title">Runtime Strategy</div>
					<h2>{strategySummary.name}</h2>
					<p>{strategySummary.detail}</p>
					<div className="knowledge-runtime-flags">
						<span>{knowledgeRuntime.manifestEnabled ? 'Manifest pinned' : 'Manifest hidden'}</span>
						<span>{knowledgeRuntime.autoRetrieve ? 'Auto retrieval on' : 'Auto retrieval off'}</span>
						<span>{knowledgeRuntime.knowledgeTools ? 'Agent tools on' : 'Agent tools off'}</span>
					</div>
				</div>
				<div className="knowledge-strategy-grid">
					{Object.values(KNOWLEDGE_RUNTIME_STRATEGIES).map(strategy => (
						<button
							key={strategy.id}
							type="button"
							className={`knowledge-strategy-card ${knowledgeRuntime.strategy === strategy.id ? 'active' : ''}`}
							onClick={() => changeKnowledgeStrategy(strategy.id)}
							disabled={isLoading}
						>
							<strong>{strategy.name}</strong>
							<span>{strategy.description}</span>
						</button>
					))}
				</div>
				<div className="knowledge-runtime-bounds">
					<label>
						<span>Top K</span>
						<input className="input" type="number" min="1" max="20" value={runtimeDraft?.topK ?? ''} onChange={event => setRuntimeDraft(prev => ({ ...(prev || {}), topK: event.target.value }))} />
					</label>
					<label>
						<span>Max chars</span>
						<input className="input" type="number" min="500" max="50000" value={runtimeDraft?.maxChars ?? ''} onChange={event => setRuntimeDraft(prev => ({ ...(prev || {}), maxChars: event.target.value }))} />
					</label>
					<label>
						<span>Score threshold</span>
						<input className="input" type="number" min="0" step="0.1" value={runtimeDraft?.scoreThreshold ?? ''} onChange={event => setRuntimeDraft(prev => ({ ...(prev || {}), scoreThreshold: event.target.value }))} />
					</label>
					<button className="btn btn-ghost" onClick={applyRuntimeBounds} disabled={isLoading || !harness?.id}>Apply Bounds</button>
				</div>
			</section>

			<div className="knowledge-library-shell">
				<div className="knowledge-library-toolbar">
					<div>
						<div className="knowledge-panel-title">Library</div>
						<p>{selectedBase ? 'Inspecting one knowledge base.' : 'Select an existing base or create a new one.'}</p>
					</div>
					<div style={{ display: 'flex', gap: 8 }}>
						{selectedBase && (
							<button className="btn btn-ghost" onClick={() => setSelectedId('')}>Back to Library</button>
						)}
						<button className="btn btn-primary" onClick={() => setShowCreateForm(value => !value)}>
							{showCreateForm ? 'Close' : 'Create'}
						</button>
					</div>
				</div>

				{showCreateForm && (
					<div className="knowledge-create-box knowledge-create-inline">
						<div>
							<div className="knowledge-section-title"><span>Create Knowledge Base</span></div>
							<p>Start with a name and description. Files can be added after creation.</p>
						</div>
						<div className="knowledge-create-fields">
							<input className="input" placeholder="Knowledge base name" value={newName} onChange={event => setNewName(event.target.value)} />
							<input className="input" placeholder="Short description" value={newDescription} onChange={event => setNewDescription(event.target.value)} />
							<button className="btn btn-primary" onClick={createKnowledgeBase} disabled={isLoading}>Create Base</button>
						</div>
					</div>
				)}

				{!selectedBase ? (
					<div className="knowledge-card-grid">
						{bases.map(base => (
							<button
								key={base.id}
								type="button"
								className="knowledge-base-card"
								onClick={() => setSelectedId(base.id)}
							>
								<div className="knowledge-base-card-top">
									<span className="knowledge-base-monogram">KB</span>
									<span className="knowledge-list-status">{getKnowledgeBaseStatusSummary(base, false)}</span>
								</div>
								<div>
									<h2>{base.name}</h2>
									<p>{base.description || 'No description provided.'}</p>
								</div>
								<div className="knowledge-base-card-meta">
									<span>{base.fileCount} files</span>
									<span>{base.chunkCount} chunks</span>
									<span>{formatDate(base.updatedAt)}</span>
								</div>
							</button>
						))}
						{!hasLoadedBases && bases.length === 0 && (
							<div className="knowledge-muted-box">Loading knowledge bases...</div>
						)}
						{hasLoadedBases && bases.length === 0 && (
							<EmptyPanel title="No knowledge bases yet" body="Create a base first. Then open it to add files and test retrieval." />
						)}
					</div>
				) : (
					<div className="knowledge-detail-panel">
						<div className="knowledge-detail-layout">
							<div className="knowledge-detail-header">
								<div>
									<div className="knowledge-eyebrow">Selected Base</div>
									<h2>{selectedBase.name}</h2>
									<p>{selectedBase.description || 'No description provided.'}</p>
								</div>
								<button className="btn btn-danger" onClick={deleteKnowledgeBase} disabled={isLoading}>Delete</button>
							</div>

							<div className="knowledge-metric-row">
								<Metric label="files" value={selectedBase.fileCount} />
								<Metric label="chunks" value={selectedBase.chunkCount} />
								<Metric label="updated" value={formatDate(selectedBase.updatedAt)} />
								<Metric label="chunk size" value={selectedRawBase?.settings?.chunkSize || settings.chunkSize} />
								<Metric label="overlap" value={selectedRawBase?.settings?.overlap || settings.overlap} />
							</div>

							<div className="knowledge-quality-panel">
								<div className="knowledge-section-title">
									<span>Retrieval Quality</span>
									<small>Configure the pipeline from recall to rerank.</small>
								</div>
								<div className="knowledge-quality-stack">
									<div className="knowledge-quality-group">
										<div className="knowledge-quality-group-head">
											<div>
												<strong>Recall</strong>
												<span>Choose how candidates are gathered before optional rerank.</span>
											</div>
											<em>{baseRetrievalDraft?.retrievalStrategy || 'keyword'}</em>
										</div>
										<div className="knowledge-quality-grid compact">
											<label>
												<span>Retrieval strategy</span>
												<select className="input" value={baseRetrievalDraft?.retrievalStrategy || 'keyword'} onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), retrievalStrategy: event.target.value }))}>
													<option value="keyword">Keyword</option>
													<option value="vector">Vector</option>
													<option value="hybrid">Hybrid</option>
												</select>
											</label>
											<label>
												<span>Index method</span>
												<select className="input" value={baseRetrievalDraft?.indexMethod || 'keyword'} onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), indexMethod: event.target.value }))}>
													<option value="keyword">Keyword</option>
													<option value="vector">Vector</option>
													<option value="hybrid">Hybrid</option>
												</select>
											</label>
											<label>
												<span>Top K</span>
												<input className="input" type="number" min="1" max="50" value={baseRetrievalDraft?.topK ?? ''} onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), topK: event.target.value }))} />
											</label>
											<label>
												<span>Max chars</span>
												<input className="input" type="number" min="500" max="100000" value={baseRetrievalDraft?.maxChars ?? ''} onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), maxChars: event.target.value }))} />
											</label>
											<label>
												<span>Score threshold</span>
												<input className="input" type="number" min="0" step="0.1" value={baseRetrievalDraft?.scoreThreshold ?? ''} onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), scoreThreshold: event.target.value }))} />
											</label>
										</div>
									</div>

									<div className="knowledge-quality-group">
										<div className="knowledge-quality-group-head">
											<div>
												<strong>Embedding</strong>
												<span>Used when indexing vector or hybrid knowledge.</span>
											</div>
											<em>{baseRetrievalDraft?.embeddingProvider || 'none'}</em>
										</div>
										<div className="knowledge-quality-grid compact">
											<label>
												<span>Provider</span>
												<select className="input" value={baseRetrievalDraft?.embeddingProvider || 'none'} onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), embeddingProvider: event.target.value }))}>
													<option value="none">None</option>
													<option value="zhipu_embedding_3">Zhipu embedding-3</option>
													<option value="openai_compatible">OpenAI-compatible</option>
												</select>
											</label>
											{(baseRetrievalDraft?.embeddingProvider || 'none') !== 'none' && (
												<>
													<label>
														<span>Model</span>
														<input className="input" value={baseRetrievalDraft?.embeddingModel ?? ''} placeholder="embedding-3" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), embeddingModel: event.target.value }))} />
													</label>
													<label>
														<span>Dimensions</span>
														<input className="input" type="number" min="1" max="8192" value={baseRetrievalDraft?.embeddingDimensions ?? ''} placeholder="1024" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), embeddingDimensions: event.target.value }))} />
													</label>
													<label className="wide">
														<span>Embedding URL</span>
														<input className="input" value={baseRetrievalDraft?.embeddingBaseUrl ?? ''} placeholder="https://open.bigmodel.cn/api/paas/v4/embeddings" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), embeddingBaseUrl: event.target.value }))} />
													</label>
													<label>
														<span>API key env</span>
														<input className="input" value={baseRetrievalDraft?.embeddingApiKeyEnv ?? ''} placeholder="ZHIPU_API_KEY" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), embeddingApiKeyEnv: event.target.value }))} />
													</label>
													<button className="btn btn-ghost" onClick={testEmbeddingSettings} disabled={isLoading}>Test Embedding</button>
												</>
											)}
										</div>
									</div>

									<div className="knowledge-quality-group">
										<div className="knowledge-quality-group-head">
											<div>
												<strong>Vector Store</strong>
												<span>Where vectors are persisted after indexing.</span>
											</div>
											<em>{baseRetrievalDraft?.vectorStore || 'local_json'}</em>
										</div>
										<div className="knowledge-quality-grid compact">
											<label>
												<span>Store</span>
												<select className="input" value={baseRetrievalDraft?.vectorStore || 'local_json'} onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), vectorStore: event.target.value }))}>
													<option value="local_json">Local JSON</option>
													<option value="qdrant">Qdrant</option>
												</select>
											</label>
											{(baseRetrievalDraft?.vectorStore || 'local_json') === 'qdrant' && (
												<>
													<label>
														<span>Qdrant URL</span>
														<input className="input" value={baseRetrievalDraft?.qdrantUrl ?? ''} placeholder="http://localhost:6333" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), qdrantUrl: event.target.value }))} />
													</label>
													<label>
														<span>Collection</span>
														<input className="input" value={baseRetrievalDraft?.qdrantCollection ?? ''} placeholder="auto per KB" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), qdrantCollection: event.target.value }))} />
													</label>
													<label>
														<span>API key env</span>
														<input className="input" value={baseRetrievalDraft?.qdrantApiKeyEnv ?? ''} placeholder="optional" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), qdrantApiKeyEnv: event.target.value }))} />
													</label>
												</>
											)}
										</div>
									</div>

									<div className="knowledge-quality-group">
										<div className="knowledge-quality-group-head">
											<div>
												<strong>Rerank</strong>
												<span>Optional second pass over recalled chunks.</span>
											</div>
											<em>{baseRetrievalDraft?.rerankProvider || 'none'}</em>
										</div>
										<div className="knowledge-quality-grid compact">
											<label>
												<span>Provider</span>
												<select className="input" value={baseRetrievalDraft?.rerankProvider || 'none'} onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), rerankProvider: event.target.value }))}>
													<option value="none">None</option>
													<option value="qwen3_rerank">Qwen3 Rerank</option>
												</select>
											</label>
											{(baseRetrievalDraft?.rerankProvider || 'none') !== 'none' && (
												<>
													<label>
														<span>Model</span>
														<input className="input" value={baseRetrievalDraft?.rerankModel ?? ''} placeholder="qwen3-rerank" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), rerankModel: event.target.value }))} />
													</label>
													<label>
														<span>Top N</span>
														<input className="input" type="number" min="0" max="100" value={baseRetrievalDraft?.rerankTopN ?? ''} placeholder="same as Top K" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), rerankTopN: event.target.value }))} />
													</label>
													<label className="wide">
														<span>Rerank URL</span>
														<input className="input" value={baseRetrievalDraft?.rerankBaseUrl ?? ''} placeholder="https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), rerankBaseUrl: event.target.value }))} />
													</label>
													<label>
														<span>API key env</span>
														<input className="input" value={baseRetrievalDraft?.rerankApiKeyEnv ?? ''} placeholder="DASHSCOPE_API_KEY" onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), rerankApiKeyEnv: event.target.value }))} />
													</label>
													<label className="wide">
														<span>Instruct</span>
														<input className="input" value={baseRetrievalDraft?.rerankInstruct ?? ''} placeholder="Given a web search query, retrieve relevant passages that answer the query." onChange={event => setBaseRetrievalDraft(prev => ({ ...(prev || {}), rerankInstruct: event.target.value }))} />
													</label>
													<button className="btn btn-ghost" onClick={testRerankSettings} disabled={isLoading}>Test Rerank</button>
												</>
											)}
										</div>
									</div>

									<div className="knowledge-quality-actions">
										<button className="btn btn-ghost" onClick={saveBaseRetrievalSettings} disabled={isLoading}>Save Retrieval Settings</button>
									</div>
								</div>
							</div>

							<div className="knowledge-section-grid">
								<div className="knowledge-section">
									<div className="knowledge-section-title">
										<span>Index File</span>
										<small>Chunk settings apply only to this indexing run.</small>
									</div>
									<div className="knowledge-settings-grid">
										<label>
											<span>Chunk size</span>
											<input className="input" type="number" min="200" max="4000" value={settings.chunkSize} onChange={event => setSettings(prev => ({ ...prev, chunkSize: event.target.value }))} />
										</label>
										<label>
											<span>Overlap</span>
											<input className="input" type="number" min="0" max="1000" value={settings.overlap} onChange={event => setSettings(prev => ({ ...prev, overlap: event.target.value }))} />
										</label>
									</div>
									<div className="knowledge-file-picker">
										<input
											id={`knowledge-file-${selectedBase.id}`}
											className="knowledge-file-input"
											type="file"
											accept={ACCEPTED_KNOWLEDGE_FILE_TYPES}
											onChange={event => setSelectedFile(event.target.files?.[0] || null)}
										/>
										<label className="btn btn-ghost knowledge-file-select" htmlFor={`knowledge-file-${selectedBase.id}`}>
											Choose File
										</label>
										<div className="knowledge-file-summary">
											<strong>{selectedFile ? selectedFile.name : 'No file selected'}</strong>
											<span>{selectedFile ? formatKnowledgeFileSize(selectedFile.size) : 'Markdown, text, JSON, CSV, PDF, or DOCX'}</span>
										</div>
									</div>
									<div className="knowledge-file-action">
										<span>Chunk settings are applied when this file is indexed.</span>
										<button className="btn btn-primary" onClick={uploadFile} disabled={!selectedFile || isIndexing}>{isIndexing ? 'Indexing...' : 'Index'}</button>
									</div>
								</div>

								<div className="knowledge-section">
									<div className="knowledge-section-title">
										<span>Imported Files</span>
										<small>{files.length} indexed source{files.length === 1 ? '' : 's'}</small>
									</div>
									<div className="knowledge-file-list">
										{files.map(file => (
											<div key={file.id} className="knowledge-file-row">
												<div>
													<strong>{file.filename}</strong>
													<small>{file.loader || file.parser} · {formatDate(file.importedAt)}</small>
												</div>
												<span>{formatKnowledgeFileSize(file.size)}</span>
											</div>
										))}
										{files.length === 0 && (
											<div className="knowledge-muted-box">No files indexed yet.</div>
										)}
									</div>
								</div>
							</div>

							<div className="knowledge-retrieval-panel">
								<div className="knowledge-section-title">
									<span>Retrieval Test</span>
									<small>{baseRetrievalDraft?.retrievalStrategy || 'keyword'} · top {baseRetrievalDraft?.topK || 5}</small>
								</div>
								<div className="knowledge-query-row">
									<textarea className="textarea" placeholder="Ask a question this knowledge base should answer..." value={query} onChange={event => setQuery(event.target.value)} />
									<button className="btn btn-ghost" onClick={testRetrieval} disabled={!query.trim() || isLoading}>Run Retrieval</button>
								</div>
								<div className="knowledge-results">
									{retrieval?.chunks?.map((chunk, index) => (
										<div key={chunk.id || index} className="knowledge-result">
											<div className="knowledge-result-meta">
												<span>#{index + 1} {chunk.source?.filename || selectedRawBase?.name || 'source'}</span>
												<span>score {Number(chunk.score || 0).toFixed(3)}</span>
											</div>
											<p>{compactSnippet(chunk.text)}</p>
										</div>
									))}
									{retrieval && retrieval.chunks?.length === 0 && (
										<div className="knowledge-muted-box">No matching chunks found.</div>
									)}
								</div>
							</div>

							<div className="knowledge-retrieval-panel">
								<div className="knowledge-section-title">
									<span>Recent Retrieval Records</span>
									<small>{retrievalRecords.length} record{retrievalRecords.length === 1 ? '' : 's'}</small>
								</div>
								<div className="knowledge-record-list">
									{retrievalRecords.map(record => (
										<div key={record.id} className="knowledge-record-row">
											<div>
												<strong>{record.query || '(empty query)'}</strong>
												<small>{record.strategy} · {record.resultCount} result{record.resultCount === 1 ? '' : 's'} · {formatDate(record.createdAt)}</small>
											</div>
											<span>{(record.sources || []).map(source => source.filename).join(', ') || 'no sources'}</span>
										</div>
									))}
									{retrievalRecords.length === 0 && (
										<div className="knowledge-muted-box">No retrieval records yet. Run a retrieval test or ask the agent to query this base.</div>
									)}
								</div>
							</div>
						</div>
					</div>
				)}
			</div>

			{status && <div className="knowledge-toast success">{status}</div>}
			{error && <div className="knowledge-toast error">{error}</div>}
		</div>
	);
}
