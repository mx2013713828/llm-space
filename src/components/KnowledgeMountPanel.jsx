import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiFetch } from '../lib/apiClient.js';
import { getKnowledgeBaseStatusSummary, normalizeKnowledgeBaseSummary } from '../lib/knowledgeBases.js';

function MiniStatus({ children, active = false }) {
	return (
		<span style={{
			border: `1px solid ${active ? 'rgba(34, 197, 94, 0.35)' : 'var(--border)'}`,
			background: active ? 'rgba(34, 197, 94, 0.12)' : 'var(--bg-base)',
			color: active ? 'var(--green)' : 'var(--text-muted)',
			borderRadius: 999,
			fontSize: 10,
			padding: '2px 7px',
			textTransform: 'uppercase',
			letterSpacing: 0,
			flexShrink: 0,
		}}>
			{children}
		</span>
	);
}

export function KnowledgeMountPanel({ harnessId }) {
	const navigate = useNavigate();
	const [knowledgeBases, setKnowledgeBases] = useState([]);
	const [mountedIds, setMountedIds] = useState([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');

	const bases = useMemo(() => knowledgeBases.map(normalizeKnowledgeBaseSummary), [knowledgeBases]);
	const mountedSet = useMemo(() => new Set(mountedIds), [mountedIds]);

	const loadState = useCallback(async () => {
		if (!harnessId) return;
		setIsLoading(true);
		setError('');
		try {
			const [basesRes, mountedRes] = await Promise.all([
				apiFetch('/api/knowledge-bases'),
				apiFetch(`/api/harnesses/${encodeURIComponent(harnessId)}/knowledge-bases`),
			]);
			if (!basesRes.ok) throw new Error(`Failed to load knowledge bases (${basesRes.status})`);
			if (!mountedRes.ok) throw new Error(`Failed to load mounted knowledge (${mountedRes.status})`);
			const [baseData, mountedData] = await Promise.all([basesRes.json(), mountedRes.json()]);
			setKnowledgeBases(Array.isArray(baseData) ? baseData : []);
			setMountedIds((Array.isArray(mountedData) ? mountedData : []).map(base => base.id).filter(Boolean));
		} catch (err) {
			setError(err.message || 'Failed to load mounted knowledge.');
		} finally {
			setIsLoading(false);
		}
	}, [harnessId]);

	useEffect(() => {
		void Promise.resolve().then(loadState);
	}, [loadState]);

	async function toggleMount(baseId) {
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
			const payload = await res.json();
			setMountedIds(Array.isArray(payload) ? payload.map(base => base.id).filter(Boolean) : payload.knowledgeBaseIds || []);
		} catch (err) {
			setError(err.message || 'Failed to update mounted knowledge.');
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<div className="card" style={{ padding: 14 }}>
			<div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<span style={{ width: 7, height: 7, borderRadius: '50%', background: mountedIds.length ? 'var(--green)' : 'var(--text-muted)' }} />
					Mounted Knowledge
				</div>
				<button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => navigate(`/${harnessId}/knowledge`)}>
					Manage
				</button>
			</div>

			<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
				{bases.length === 0 && (
					<div style={{ border: '1px dashed var(--border)', borderRadius: 6, padding: 10, color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5 }}>
						No knowledge bases yet. Create one in the Knowledge page.
					</div>
				)}

				{bases.map(base => {
					const mounted = mountedSet.has(base.id);
					return (
						<button
							key={base.id}
							type="button"
							onClick={() => toggleMount(base.id)}
							disabled={isLoading}
							style={{
								textAlign: 'left',
								border: `1px solid ${mounted ? 'rgba(34, 197, 94, 0.35)' : 'var(--border)'}`,
								background: mounted ? 'rgba(34, 197, 94, 0.08)' : 'var(--bg-base)',
								borderRadius: 7,
								padding: 10,
								cursor: isLoading ? 'wait' : 'pointer',
								color: 'var(--text-primary)',
								display: 'flex',
								flexDirection: 'column',
								gap: 6,
							}}
						>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
								<span style={{ fontSize: 12, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{base.name}</span>
								<MiniStatus active={mounted}>{mounted ? 'mounted' : getKnowledgeBaseStatusSummary(base, false)}</MiniStatus>
							</div>
							{base.description && (
								<div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
									{base.description}
								</div>
							)}
							<div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
								{base.fileCount} files · {base.chunkCount} chunks
							</div>
						</button>
					);
				})}

				{error && <div style={{ color: 'var(--red)', fontSize: 10 }}>{error}</div>}
			</div>
		</div>
	);
}
