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

function compactSnippet(text = '', maxLength = 220) {
	const compact = String(text || '').replace(/\s+/g, ' ').trim();
	return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function StatusPill({ children, tone = 'neutral' }) {
	const colors = {
		neutral: ['var(--bg-base)', 'var(--text-muted)', 'var(--border)'],
		success: ['rgba(34, 197, 94, 0.12)', 'var(--green)', 'rgba(34, 197, 94, 0.35)'],
		warning: ['rgba(245, 158, 11, 0.12)', 'var(--orange)', 'rgba(245, 158, 11, 0.35)'],
	};
	const [background, color, border] = colors[tone] || colors.neutral;
	return (
		<span style={{
			display: 'inline-flex',
			alignItems: 'center',
			borderRadius: 999,
			border: `1px solid ${border}`,
			background,
			color,
			fontSize: 10,
			padding: '1px 7px',
			textTransform: 'uppercase',
			letterSpacing: 0,
		}}>
			{children}
		</span>
	);
}

export function KnowledgeBasePanel({ harnessId }) {
	const [knowledgeBases, setKnowledgeBases] = useState([]);
	const [mountedIds, setMountedIds] = useState([]);
	const [selectedId, setSelectedId] = useState('');
	const [newName, setNewName] = useState('');
	const [newDescription, setNewDescription] = useState('');
	const [settings, setSettings] = useState(DEFAULT_SETTINGS);
	const [selectedFile, setSelectedFile] = useState(null);
	const [query, setQuery] = useState('');
	const [retrieval, setRetrieval] = useState(null);
	const [isLoading, setIsLoading] = useState(false);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');

	const normalizedBases = useMemo(
		() => knowledgeBases.map(normalizeKnowledgeBaseSummary),
		[knowledgeBases]
	);
	const selectedBase = normalizedBases.find(base => base.id === selectedId) || normalizedBases[0] || null;
	const mountedSet = useMemo(() => new Set(mountedIds), [mountedIds]);

	const loadKnowledgeState = useCallback(async () => {
		if (!harnessId) return;
		setIsLoading(true);
		setError('');
		try {
			const [basesRes, mountedRes] = await Promise.all([
				apiFetch('/api/knowledge-bases'),
				apiFetch(`/api/harnesses/${encodeURIComponent(harnessId)}/knowledge-bases`),
			]);
			if (!basesRes.ok) throw new Error(`Failed to load knowledge bases (${basesRes.status})`);
			if (!mountedRes.ok) throw new Error(`Failed to load mounted knowledge bases (${mountedRes.status})`);
			const bases = await basesRes.json();
			const mounted = await mountedRes.json();
			const mountedNext = (Array.isArray(mounted) ? mounted : []).map(base => base.id).filter(Boolean);
			setKnowledgeBases(Array.isArray(bases) ? bases : []);
			setMountedIds(mountedNext);
			setSelectedId(current => current || mountedNext[0] || bases?.[0]?.id || '');
			setStatus('');
		} catch (err) {
			setError(err.message || 'Failed to load knowledge bases.');
		} finally {
			setIsLoading(false);
		}
	}, [harnessId]);

	useEffect(() => {
		void Promise.resolve().then(loadKnowledgeState);
	}, [loadKnowledgeState]);

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
					description: newDescription,
					settings,
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error || `Create failed (${res.status})`);
			const created = await res.json();
			setKnowledgeBases(prev => [...prev, created]);
			setSelectedId(created.id);
			setNewName('');
			setNewDescription('');
			setStatus(`Created ${created.name}.`);
		} catch (err) {
			setError(err.message || 'Failed to create knowledge base.');
		} finally {
			setIsLoading(false);
		}
	}

	async function toggleMount(baseId) {
		if (!harnessId || !baseId) return;
		const nextIds = mountedSet.has(baseId)
			? mountedIds.filter(id => id !== baseId)
			: [...mountedIds, baseId];
		setIsLoading(true);
		setError('');
		try {
			const res = await apiFetch(`/api/harnesses/${encodeURIComponent(harnessId)}/knowledge-bases`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ knowledgeBaseIds: nextIds }),
			});
			if (!res.ok) throw new Error((await res.json()).error || `Mount failed (${res.status})`);
			const mounted = await res.json();
			setMountedIds(Array.isArray(mounted)
				? mounted.map(base => base.id).filter(Boolean)
				: mounted.knowledgeBaseIds || []);
			setStatus('Mounted knowledge updated.');
		} catch (err) {
			setError(err.message || 'Failed to update mounted knowledge.');
		} finally {
			setIsLoading(false);
		}
	}

	async function uploadFile() {
		const baseId = selectedBase?.id;
		if (!baseId || !selectedFile) return;
		if (!isSupportedKnowledgeFile(selectedFile.name)) {
			setError('Only .md, .markdown, .txt, and .json files are supported in this MVP.');
			return;
		}
		setIsLoading(true);
		setError('');
		try {
			const content = await selectedFile.text();
			const payload = buildKnowledgeFilePayload({ file: selectedFile, content, settings });
			const res = await apiFetch(`/api/knowledge-bases/${encodeURIComponent(baseId)}/files`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
			if (!res.ok) throw new Error((await res.json()).error || `Upload failed (${res.status})`);
			const result = await res.json();
			setKnowledgeBases(prev => prev.map(base => base.id === result.knowledgeBase.id ? result.knowledgeBase : base));
			setSelectedFile(null);
			setStatus(`Indexed ${result.file.filename}: ${result.chunkCount} chunks.`);
		} catch (err) {
			setError(err.message || 'Failed to upload file.');
		} finally {
			setIsLoading(false);
		}
	}

	async function testRetrieval() {
		const ids = mountedIds.length > 0 ? mountedIds : selectedBase?.id ? [selectedBase.id] : [];
		if (!query.trim() || ids.length === 0) return;
		setIsLoading(true);
		setError('');
		try {
			const res = await apiFetch('/api/knowledge-bases/retrieve', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					knowledgeBaseIds: ids,
					query,
					topK: 3,
					maxChars: 2400,
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
		<div className="card" style={{ padding: 14 }}>
			<div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				<span>Knowledge Bases</span>
				<button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={loadKnowledgeState} disabled={isLoading}>
					Refresh
				</button>
			</div>

			<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
					<input
						className="input"
						style={{ fontSize: 11, padding: '6px 8px' }}
						placeholder="New knowledge base"
						value={newName}
						onChange={event => setNewName(event.target.value)}
					/>
					<button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={createKnowledgeBase} disabled={isLoading}>
						Create
					</button>
				</div>
				<input
					className="input"
					style={{ fontSize: 11, padding: '6px 8px' }}
					placeholder="Description (optional)"
					value={newDescription}
					onChange={event => setNewDescription(event.target.value)}
				/>

				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
					<label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
						<span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Chunk</span>
						<input
							className="input"
							type="number"
							min="200"
							max="4000"
							style={{ fontSize: 11, padding: '6px 8px' }}
							value={settings.chunkSize}
							onChange={event => setSettings(prev => ({ ...prev, chunkSize: event.target.value }))}
						/>
					</label>
					<label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
						<span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Overlap</span>
						<input
							className="input"
							type="number"
							min="0"
							max="1000"
							style={{ fontSize: 11, padding: '6px 8px' }}
							value={settings.overlap}
							onChange={event => setSettings(prev => ({ ...prev, overlap: event.target.value }))}
						/>
					</label>
				</div>

				<select
					className="input"
					style={{ fontSize: 11, padding: '6px 8px' }}
					value={selectedBase?.id || ''}
					onChange={event => setSelectedId(event.target.value)}
				>
					{normalizedBases.length === 0 && <option value="">No knowledge bases</option>}
					{normalizedBases.map(base => (
						<option key={base.id} value={base.id}>{base.name}</option>
					))}
				</select>

				{selectedBase && (
					<div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 8 }}>
						<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
							<div style={{ minWidth: 0 }}>
								<div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedBase.name}</div>
								<div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{selectedBase.fileCount} files · {selectedBase.chunkCount} chunks</div>
							</div>
							<StatusPill tone={mountedSet.has(selectedBase.id) ? 'success' : selectedBase.chunkCount > 0 ? 'neutral' : 'warning'}>
								{getKnowledgeBaseStatusSummary(selectedBase, mountedSet.has(selectedBase.id))}
							</StatusPill>
						</div>
						<button
							className={mountedSet.has(selectedBase.id) ? 'btn btn-ghost' : 'btn btn-primary'}
							style={{ padding: '6px 8px', fontSize: 11 }}
							onClick={() => toggleMount(selectedBase.id)}
							disabled={isLoading}
						>
							{mountedSet.has(selectedBase.id) ? 'Unmount from this harness' : 'Mount to this harness'}
						</button>
					</div>
				)}

				<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
					<input
						className="input"
						type="file"
						accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json"
						style={{ fontSize: 11, padding: '6px 8px' }}
						onChange={event => setSelectedFile(event.target.files?.[0] || null)}
					/>
					<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
						<span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
							{selectedFile ? `${selectedFile.name} · ${formatKnowledgeFileSize(selectedFile.size)}` : 'Supports Markdown, text, and JSON.'}
						</span>
						<button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={uploadFile} disabled={isLoading || !selectedBase || !selectedFile}>
							Index
						</button>
					</div>
				</div>

				<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
					<textarea
						className="input"
						style={{ fontSize: 11, padding: '6px 8px', minHeight: 54, resize: 'vertical' }}
						placeholder="Test retrieval query"
						value={query}
						onChange={event => setQuery(event.target.value)}
					/>
					<button className="btn btn-ghost" style={{ padding: '6px 8px', fontSize: 11 }} onClick={testRetrieval} disabled={isLoading || !query.trim()}>
						Preview Retrieval
					</button>
				</div>

				{retrieval?.chunks?.length > 0 && (
					<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
						{retrieval.chunks.slice(0, 3).map((chunk, index) => (
							<div key={chunk.id || index} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, background: 'var(--bg-base)' }}>
								<div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
									#{index + 1} {chunk.knowledgeBase?.name || chunk.source?.filename || 'source'} · score {Number(chunk.score || 0).toFixed(2)}
								</div>
								<div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{compactSnippet(chunk.text)}</div>
							</div>
						))}
					</div>
				)}

				{status && <div style={{ fontSize: 10, color: 'var(--green)' }}>{status}</div>}
				{error && <div style={{ fontSize: 10, color: 'var(--red)' }}>{error}</div>}
			</div>
		</div>
	);
}
