import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, CircleAlert, Link2Off, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';

import {
	connectMcpServer,
	deleteMcpServer,
	disconnectMcpServer,
	fetchMcpCallDetail,
	fetchMcpCallSummaries,
	fetchHarnessMcpMount,
	fetchMcpPresets,
	fetchMcpServers,
	saveHarnessMcpMount,
	saveMcpServer,
	testMcpTool,
} from '../lib/mcpServers.js';
import { editorRowsToMap, mapToEditorRows } from '../lib/mcpConfigPresentation.js';
import { formatMcpAuthStatus, formatMcpCallSummary, formatMcpStatus } from '../lib/mcpRuntimePresentation.js';

const EMPTY_FORM = {
	id: '',
	name: '',
	description: '',
	transport: 'stdio',
	command: '',
	argsText: '',
	cwd: '.',
	url: '',
	envRows: [],
	headerRows: [],
	legacyAuthEnv: '',
};

function transportLabel(value) {
	return value === 'streamable_http' ? 'Streamable HTTP' : 'STDIO';
}

function parseArgs(text) {
	return String(text || '')
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean);
}

function serverToForm(server) {
	return {
		id: server?.id || '',
		name: server?.name || '',
		description: server?.description || '',
		transport: server?.transport || 'stdio',
		command: server?.command || '',
		argsText: (server?.args || []).join('\n'),
		cwd: server?.cwd || '.',
		url: server?.url || '',
		envRows: mapToEditorRows(server?.env),
		headerRows: mapToEditorRows(server?.headers),
		legacyAuthEnv: server?.auth?.type === 'bearer' ? server.auth.env || '' : '',
	};
}

function formToServer(form) {
	const base = {
		id: form.id,
		name: form.name,
		description: form.description,
		transport: form.transport,
		enabled: true,
		env: editorRowsToMap(form.envRows),
	};
	if (form.transport === 'streamable_http') {
		return {
			...base,
			url: form.url,
			headers: editorRowsToMap(form.headerRows),
		};
	}
	return {
		...base,
		command: form.command,
		args: parseArgs(form.argsText),
		cwd: form.cwd || '.',
		env: {},
	};
}

function KeyValueEditor({ label, rows, onChange, valuePlaceholder, description, allowBearer = false }) {
	const updateRow = (index, field, value) => {
		onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
	};
	const removeRow = (index) => onChange(rows.filter((_, rowIndex) => rowIndex !== index));

	return (
		<div className="mcp-kv-editor wide">
			<div className="mcp-kv-head">
				<div>
					<strong>{label}</strong>
					<span>{description}</span>
				</div>
				<button type="button" className="mcp-icon-button" title={`Add ${label}`} onClick={() => onChange([...rows, { key: '', value: '', source: 'literal' }])}>
					<Plus size={15} aria-hidden="true" />
				</button>
			</div>
			{rows.length > 0 && (
				<div className="mcp-kv-rows">
					{rows.map((row, index) => (
						<div className="mcp-kv-row" key={`${row.key}-${index}`}>
							<input className="input" value={row.key} aria-label={`${label} name`} placeholder="Name" onChange={event => updateRow(index, 'key', event.target.value)} />
							<select className="input" value={row.source || 'literal'} aria-label={`${label} source`} onChange={event => updateRow(index, 'source', event.target.value)}>
								<option value="literal">Stored value</option>
								<option value="environment">Environment reference</option>
								{allowBearer && <option value="bearer">Bearer token</option>}
							</select>
							<input className="input" value={row.value} aria-label={`${label} value`} placeholder={valuePlaceholder} onChange={event => updateRow(index, 'value', event.target.value)} />
							<button type="button" className="mcp-icon-button danger" title={`Remove ${label}`} onClick={() => removeRow(index)}>
								<Trash2 size={14} aria-hidden="true" />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function ServerCard({ server, status, selected, mounted, onClick }) {
	const lifecycle = formatMcpStatus(status);
	return (
		<button className={`mcp-server-card ${selected ? 'selected' : ''}`} onClick={onClick}>
			<div className="mcp-server-card-main">
				<span className={`mcp-status-dot ${lifecycle.tone}`} />
				<div>
					<div className="mcp-server-name">{server.name}</div>
					<div className="mcp-server-subtitle">{server.id} · {transportLabel(server.transport)}</div>
				</div>
			</div>
			<div className="mcp-server-card-meta">
				<span className={`mcp-pill ${lifecycle.tone}`}>{lifecycle.label}</span>
				{mounted && <span className="mcp-pill blue">Mounted</span>}
			</div>
		</button>
	);
}

export function McpPage({ harness }) {
	const [servers, setServers] = useState([]);
	const [statuses, setStatuses] = useState({});
	const [presets, setPresets] = useState([]);
	const [selectedId, setSelectedId] = useState('');
	const [mount, setMount] = useState({ enabled: false, mountedServers: [], toolAllowlist: {} });
	const [mountedDefinitions, setMountedDefinitions] = useState([]);
	const [form, setForm] = useState(EMPTY_FORM);
	const [showForm, setShowForm] = useState(false);
	const [busy, setBusy] = useState('');
	const [notice, setNotice] = useState('');
	const [error, setError] = useState('');
	const [testOutput, setTestOutput] = useState('');
	const [callSummaries, setCallSummaries] = useState([]);
	const [expandedCallId, setExpandedCallId] = useState('');
	const [callDetail, setCallDetail] = useState(null);

	const selectedServer = useMemo(
		() => servers.find(server => server.id === selectedId) || servers[0] || null,
		[servers, selectedId],
	);
	const selectedStatus = selectedServer ? statuses[selectedServer.id] : null;
	const selectedTools = selectedStatus?.tools || [];
	const mountedServers = new Set(mount.mountedServers || []);
	const selectedAllowlist = selectedServer ? new Set(mount.toolAllowlist?.[selectedServer.id] || []) : new Set();
	const lifecycle = formatMcpStatus(selectedStatus);
	const auth = formatMcpAuthStatus(selectedStatus?.auth);

	const loadAll = useCallback(async () => {
		setError('');
		try {
			const [presetData, serverData, mountData] = await Promise.all([
				fetchMcpPresets(),
				fetchMcpServers(),
				fetchHarnessMcpMount(harness?.id),
			]);
			setPresets(Array.isArray(presetData) ? presetData : []);
			setServers(serverData.servers || []);
			setStatuses(serverData.statuses || {});
			setMount(mountData.mount || { enabled: false, mountedServers: [], toolAllowlist: {} });
			setMountedDefinitions(mountData.toolDefinitions || []);
			setSelectedId(current => serverData.servers?.some?.(server => server.id === current)
				? current
				: (serverData.servers?.[0]?.id || ''));
		} catch (err) {
			setError(err.message || 'Failed to load MCP configuration.');
		}
	}, [harness?.id]);

	useEffect(() => {
		void loadAll();
	}, [loadAll]);

	useEffect(() => {
		if (!selectedServer?.id) {
			setCallSummaries([]);
			return undefined;
		}
		let active = true;
		void fetchMcpCallSummaries(selectedServer.id)
			.then(calls => { if (active) setCallSummaries(calls); })
			.catch(() => { if (active) setCallSummaries([]); });
		return () => { active = false; };
	}, [selectedServer?.id, selectedStatus?.status]);

	const refreshMount = useCallback(async () => {
		if (!harness?.id) return;
		const next = await fetchHarnessMcpMount(harness.id);
		setMount(next.mount || mount);
		setMountedDefinitions(next.toolDefinitions || []);
	}, [harness?.id, mount]);

	const handleAddPreset = async (preset) => {
		setBusy(`preset:${preset.id}`);
		setError('');
		try {
			const saved = await saveMcpServer(preset);
			setNotice(`Added ${saved.name}. Connect it to discover tools.`);
			setSelectedId(saved.id);
			await loadAll();
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy('');
		}
	};

	const handleSaveForm = async (event) => {
		event.preventDefault();
		setBusy('save');
		setError('');
		try {
			const saved = await saveMcpServer(formToServer(form));
			setNotice(`Saved ${saved.name}.`);
			setSelectedId(saved.id);
			setShowForm(false);
			setForm(EMPTY_FORM);
			await loadAll();
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy('');
		}
	};

	const handleConnect = async (serverId) => {
		setBusy(`connect:${serverId}`);
		setError('');
		setTestOutput('');
		setStatuses(prev => ({ ...prev, [serverId]: { ...(prev[serverId] || {}), status: 'starting' } }));
		try {
			const status = await connectMcpServer(serverId);
			setStatuses(prev => ({ ...prev, [serverId]: status }));
			setNotice(`${serverId} connected with ${status.tools?.length || 0} tools.`);
			await refreshMount();
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy('');
		}
	};

	const handleDisconnect = async (serverId) => {
		setBusy(`disconnect:${serverId}`);
		setError('');
		try {
			const status = await disconnectMcpServer(serverId);
			setStatuses(prev => ({ ...prev, [serverId]: status }));
			setNotice(`${serverId} disconnected.`);
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy('');
		}
	};

	const handleTest = async () => {
		if (!selectedServer || selectedTools.length === 0) return;
		const firstTool = selectedTools[0];
		const args = {};
		for (const [key, schema] of Object.entries(firstTool.inputSchema?.properties || {})) {
			args[key] = schema.type === 'number' ? 1 : 'LLM Space MCP test';
		}
		setBusy(`test:${selectedServer.id}`);
		setError('');
		try {
			const result = await testMcpTool(selectedServer.id, firstTool.name, args);
			setTestOutput(result.output || '');
			setCallSummaries(await fetchMcpCallSummaries(selectedServer.id));
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy('');
		}
	};

	const setMountPolicy = async (scope, value, toolName = '') => {
		if (!selectedServer) return;
		let nextMount;
		if (scope === 'harness') {
			nextMount = { ...mount, approvalMode: value };
		} else if (scope === 'server') {
			nextMount = { ...mount, serverApprovalModes: { ...(mount.serverApprovalModes || {}), [selectedServer.id]: value } };
		} else {
			nextMount = {
				...mount,
				toolApprovalModes: {
					...(mount.toolApprovalModes || {}),
					[selectedServer.id]: { ...(mount.toolApprovalModes?.[selectedServer.id] || {}), [toolName]: value },
				},
			};
		}
		await persistMount(nextMount);
	};

	const toggleCallDetail = async (callId) => {
		if (!selectedServer || expandedCallId === callId) {
			setExpandedCallId('');
			setCallDetail(null);
			return;
		}
		setExpandedCallId(callId);
		setCallDetail(null);
		try {
			setCallDetail(await fetchMcpCallDetail(selectedServer.id, callId));
		} catch (err) {
			setError(err.message);
		}
	};

	const persistMount = async (nextMount) => {
		if (!harness?.id) {
			setError('Select a harness before mounting MCP servers.');
			return;
		}
		setMount(nextMount);
		const saved = await saveHarnessMcpMount(harness.id, nextMount);
		setMount(saved);
		await refreshMount();
	};

	const toggleServerMount = async (serverId) => {
		const isMounted = mountedServers.has(serverId);
		const nextServers = isMounted
			? (mount.mountedServers || []).filter(id => id !== serverId)
			: [...(mount.mountedServers || []), serverId];
		const nextAllowlist = { ...(mount.toolAllowlist || {}) };
		if (!isMounted && selectedTools.length > 0) {
			nextAllowlist[serverId] = selectedTools.map(tool => tool.name);
		}
		await persistMount({ ...mount, enabled: true, mountedServers: nextServers, toolAllowlist: nextAllowlist });
	};

	const toggleToolMount = async (toolName) => {
		if (!selectedServer) return;
		const current = new Set(mount.toolAllowlist?.[selectedServer.id] || []);
		if (current.has(toolName)) current.delete(toolName);
		else current.add(toolName);
		await persistMount({
			...mount,
			enabled: true,
			mountedServers: mountedServers.has(selectedServer.id)
				? mount.mountedServers
				: [...(mount.mountedServers || []), selectedServer.id],
			toolAllowlist: {
				...(mount.toolAllowlist || {}),
				[selectedServer.id]: [...current],
			},
		});
	};

	const handleDelete = async () => {
		if (!selectedServer || !confirm(`Delete MCP server "${selectedServer.name}"?`)) return;
		setBusy(`delete:${selectedServer.id}`);
		try {
			await deleteMcpServer(selectedServer.id);
			setNotice(`Deleted ${selectedServer.name}.`);
			setSelectedId('');
			await loadAll();
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy('');
		}
	};

	return (
		<div className="mcp-page">
			<section className="mcp-header">
				<div>
					<div className="mcp-eyebrow">External Tool Provider</div>
					<h1>MCP Studio</h1>
					<p>Configure local STDIO and Streamable HTTP MCP servers, discover tools, and mount selected tools into the current harness.</p>
				</div>
				<div className="mcp-harness-chip">
					<span>Current harness</span>
					<strong>{harness?.id || 'none selected'}</strong>
				</div>
			</section>

			{(error || notice) && (
				<div className={`mcp-alert ${error ? 'error' : ''}`}>{error || notice}</div>
			)}

			<div className="mcp-layout">
				<aside className="mcp-sidebar">
					<div className="mcp-panel-title">
						<span>Configured servers</span>
						<button className="btn btn-ghost" onClick={() => setShowForm(value => !value)}>Add</button>
					</div>
					<div className="mcp-server-list">
						{servers.map(server => (
							<ServerCard
								key={server.id}
								server={server}
								status={statuses[server.id]}
								selected={selectedServer?.id === server.id}
								mounted={mountedServers.has(server.id)}
								onClick={() => setSelectedId(server.id)}
							/>
						))}
						{servers.length === 0 && <div className="mcp-empty">No MCP servers configured yet.</div>}
					</div>

					<div className="mcp-presets">
						<div className="mcp-section-label">Presets</div>
						{presets.map(preset => (
							<button
								key={preset.id}
								className="mcp-preset"
								disabled={busy === `preset:${preset.id}`}
								onClick={() => handleAddPreset(preset)}
							>
								<div>
									<strong>{preset.name}</strong>
									<span>{preset.command} {(preset.args || []).join(' ')}</span>
								</div>
								<span>+</span>
							</button>
						))}
					</div>
				</aside>

				<main className="mcp-detail">
					{showForm && (
						<form className="mcp-form" onSubmit={handleSaveForm}>
							<div className="mcp-panel-title">
								<span>{form.id ? 'Edit MCP server' : 'New MCP server'}</span>
								<button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Close</button>
							</div>
							<div className="mcp-form-grid">
								<label>Name<input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
								<label>ID<input className="input" value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} placeholder="auto from name" /></label>
								<label>Transport
									<select className="input" value={form.transport} onChange={e => setForm({ ...form, transport: e.target.value })}>
										<option value="stdio">STDIO</option>
										<option value="streamable_http">Streamable HTTP</option>
									</select>
								</label>
								<label>Description<input className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
								{form.transport === 'stdio' ? (
									<>
										<label>Command<input className="input" value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} required /></label>
										<label>CWD<input className="input" value={form.cwd} onChange={e => setForm({ ...form, cwd: e.target.value })} /></label>
										<label className="wide">Args, one per line<textarea className="textarea" value={form.argsText} onChange={e => setForm({ ...form, argsText: e.target.value })} /></label>
										<KeyValueEditor
											label="Environment"
											rows={form.envRows}
											onChange={envRows => setForm({ ...form, envRows })}
											valuePlaceholder="Value stored locally"
											description="Stored values override the shell. Environment references resolve when the server starts."
										/>
									</>
								) : (
									<>
										<label className="wide">URL<input className="input" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} required /></label>
										{form.legacyAuthEnv && <div className="mcp-legacy-note wide">Legacy bearer environment <code>{form.legacyAuthEnv}</code> is active. Saving this server removes it; add an <code>Authorization</code> header here to migrate deliberately.</div>}
										<KeyValueEditor
											label="HTTP headers"
											rows={form.headerRows}
											onChange={headerRows => setForm({ ...form, headerRows })}
											valuePlaceholder="Header value stored locally"
											description="Use any header, including Authorization, X-API-Key, or custom provider fields."
											allowBearer
										/>
									</>
								)}
							</div>
							<button className="btn btn-primary" disabled={busy === 'save'}>Save server</button>
						</form>
					)}

					{selectedServer ? (
						<div className="mcp-server-detail">
							<div className="mcp-detail-head">
								<div>
									<div className="mcp-eyebrow">{transportLabel(selectedServer.transport)}</div>
									<h2>{selectedServer.name}</h2>
									<p>{selectedServer.description || selectedServer.id}</p>
								</div>
								<div className="mcp-actions">
									<button className="btn btn-ghost" onClick={() => { setForm(serverToForm(selectedServer)); setShowForm(true); }}>Edit</button>
									{selectedStatus?.status === 'connected' ? (
										<button className="btn btn-ghost" disabled={busy === `disconnect:${selectedServer.id}`} onClick={() => handleDisconnect(selectedServer.id)}>
											<Link2Off size={14} aria-hidden="true" /> Disconnect
										</button>
									) : (
										<button className="btn btn-ghost" disabled={busy === `connect:${selectedServer.id}`} onClick={() => handleConnect(selectedServer.id)}>
											{busy === `connect:${selectedServer.id}` ? <LoaderCircle size={14} className="mcp-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} Connect
										</button>
									)}
									<button className="btn btn-danger" disabled={busy === `delete:${selectedServer.id}`} onClick={handleDelete}>Delete</button>
								</div>
							</div>

							<div className="mcp-command-box">
								<span>{selectedServer.transport === 'stdio' ? 'Command' : 'URL'}</span>
								<code>{selectedServer.transport === 'stdio'
									? `${selectedServer.command} ${(selectedServer.args || []).join(' ')}`
									: selectedServer.url}</code>
							</div>

							<div className="mcp-runtime-facts" aria-label="MCP runtime status">
								<div><span>Lifecycle</span><strong className={`mcp-status-text ${lifecycle.tone}`}>{lifecycle.label}</strong></div>
								<div><span>Authentication</span><strong className={`mcp-auth-text ${auth.tone}`}>{auth.label}</strong></div>
								<div><span>Tools</span><strong>{selectedTools.length}</strong></div>
								{selectedStatus?.error && <div className="mcp-runtime-error"><CircleAlert size={14} aria-hidden="true" /><span>{selectedStatus.error.code}: {selectedStatus.error.message}</span></div>}
								{selectedStatus?.diagnostic && <pre className="mcp-diagnostic">{selectedStatus.diagnostic}</pre>}
							</div>

							<div className="mcp-detail-grid">
								<section className="mcp-card">
									<div className="mcp-panel-title">
										<span>Discovered tools</span>
										<button className="btn btn-ghost" disabled={selectedTools.length === 0} onClick={handleTest}>Test first tool</button>
									</div>
									<div className="mcp-tool-list">
										{selectedTools.map(tool => (
											<label key={tool.name} className="mcp-tool-row">
												<input
													type="checkbox"
													checked={selectedAllowlist.has(tool.name)}
													onChange={() => toggleToolMount(tool.name)}
												/>
												<div>
													<strong>{tool.name}</strong>
													<span>{tool.description || 'No description provided.'}</span>
													<select className="input mcp-tool-policy" value={mount.toolApprovalModes?.[selectedServer.id]?.[tool.name] || ''} onChange={event => event.target.value && setMountPolicy('tool', event.target.value, tool.name)} aria-label={`${tool.name} approval policy`}>
														<option value="">Use server default</option>
														<option value="auto_readonly">Auto read-only</option>
														<option value="ask_all">Ask every call</option>
														<option value="auto_all">Auto allow</option>
													</select>
												</div>
											</label>
										))}
										{selectedTools.length === 0 && <div className="mcp-empty">Connect this server to discover tools.</div>}
									</div>
								</section>

								<section className="mcp-card">
									<div className="mcp-panel-title">
										<span>Harness mount</span>
										<button className="btn btn-ghost" onClick={() => toggleServerMount(selectedServer.id)}>
											{mountedServers.has(selectedServer.id) ? 'Unmount' : 'Mount'}
										</button>
									</div>
									<div className="mcp-mount-summary">
										<div><span>Enabled</span><strong>{mount.enabled ? 'Yes' : 'No'}</strong></div>
										<div><span>Mounted servers</span><strong>{mount.mountedServers?.length || 0}</strong></div>
										<div><span>Mounted tools</span><strong>{mountedDefinitions.length}</strong></div>
										<label className="mcp-policy-select"><span>Harness policy</span><select className="input" value={mount.approvalMode || 'auto_readonly'} onChange={event => setMountPolicy('harness', event.target.value)}><option value="auto_readonly">Auto read-only</option><option value="ask_all">Ask every call</option><option value="auto_all">Auto allow</option></select></label>
										<label className="mcp-policy-select"><span>Server override</span><select className="input" value={mount.serverApprovalModes?.[selectedServer.id] || ''} onChange={event => event.target.value && setMountPolicy('server', event.target.value)}><option value="">Use harness policy</option><option value="auto_readonly">Auto read-only</option><option value="ask_all">Ask every call</option><option value="auto_all">Auto allow</option></select></label>
									</div>
									{testOutput && (
										<pre className="mcp-output">{testOutput}</pre>
									)}
									<div className="mcp-call-log">
										<div className="mcp-section-label">Recent calls</div>
										{callSummaries.map(call => {
											const summary = formatMcpCallSummary(call);
											return <div className="mcp-call-row" key={summary.id}>
												<button type="button" onClick={() => toggleCallDetail(summary.id)}><span><strong>{summary.label}</strong><small>{summary.meta}</small></span><ChevronDown size={14} className={expandedCallId === summary.id ? 'mcp-call-open' : ''} aria-hidden="true" /></button>
												{summary.error && <span className="mcp-call-error">{summary.error}</span>}
												{expandedCallId === summary.id && callDetail && <pre className="mcp-call-detail">{callDetail.outputPreview || callDetail.error || 'No output preview.'}</pre>}
											</div>;
										})}
										{callSummaries.length === 0 && <div className="mcp-empty">No calls recorded for this server.</div>}
									</div>
								</section>
							</div>
						</div>
					) : (
						<div className="mcp-empty large">Add Context7 or your own MCP server to get started.</div>
					)}
				</main>
			</div>
		</div>
	);
}
