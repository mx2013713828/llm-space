import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../lib/apiClient.js';
import {
	buildKnowledgeFilePayload,
	formatKnowledgeFileSize,
	getKnowledgeBaseStatusSummary,
	isSupportedKnowledgeFile,
	normalizeKnowledgeBaseSummary,
} from '../lib/knowledgeBases.js';

const DEFAULT_SETTINGS = {
	chunkSize: 1000,
	overlap: 150,
};

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

export function KnowledgePage({ harness }) {
	const [knowledgeBases, setKnowledgeBases] = useState([]);
	const [selectedId, setSelectedId] = useState('');
	const [files, setFiles] = useState([]);
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

	const bases = useMemo(() => knowledgeBases.map(normalizeKnowledgeBaseSummary), [knowledgeBases]);
	const selectedBase = bases.find(base => base.id === selectedId) || null;
	const selectedRawBase = knowledgeBases.find(base => base.id === selectedBase?.id) || null;

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

	useEffect(() => {
		void Promise.resolve().then(loadBases);
	}, [loadBases]);

	useEffect(() => {
		void Promise.resolve().then(() => loadFiles(selectedBase?.id));
	}, [loadFiles, selectedBase?.id]);

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

	async function uploadFile() {
		if (!selectedBase || !selectedFile) return;
		if (!isSupportedKnowledgeFile(selectedFile.name)) {
			setError('Only .md, .markdown, .txt, and .json files are supported in this MVP.');
			return;
		}
		setIsIndexing(true);
		setError('');
		try {
			const content = await selectedFile.text();
			const payload = buildKnowledgeFilePayload({ file: selectedFile, content, settings });
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
			setStatus(`Indexed ${result.file.filename}: ${result.chunkCount} chunks.`);
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
					topK: 5,
					maxChars: 4000,
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error || `Retrieve failed (${res.status})`);
			setRetrieval(await res.json());
			setStatus('Retrieval preview updated.');
		} catch (err) {
			setError(err.message || 'Failed to retrieve knowledge.');
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
					<Metric label="formats" value="MD TXT JSON" />
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
											accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json"
											onChange={event => setSelectedFile(event.target.files?.[0] || null)}
										/>
										<label className="btn btn-ghost knowledge-file-select" htmlFor={`knowledge-file-${selectedBase.id}`}>
											Choose File
										</label>
										<div className="knowledge-file-summary">
											<strong>{selectedFile ? selectedFile.name : 'No file selected'}</strong>
											<span>{selectedFile ? formatKnowledgeFileSize(selectedFile.size) : 'Markdown, text, or JSON'}</span>
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
													<small>{file.parser} · {formatDate(file.importedAt)}</small>
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
									<small>Query this base without starting an agent loop.</small>
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
						</div>
					</div>
				)}
			</div>

			{status && <div className="knowledge-toast success">{status}</div>}
			{error && <div className="knowledge-toast error">{error}</div>}
		</div>
	);
}
