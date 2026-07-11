import { useEffect, useRef, useState } from 'react';
import {
	Copy,
	FileCode2,
	MoreHorizontal,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
	X,
} from 'lucide-react';

import { HarnessIdentity } from './HarnessIdentity';
import {
	closeHarnessDialog,
	createHarnessExplorerState,
	getHarnessCountLabel,
	openHarnessDelete,
	openHarnessDialog,
	previewHarnessId,
} from '../lib/harnessExplorerState.js';

const DIALOG_COPY = {
	create: {
		eyebrow: 'New workspace',
		title: 'Create Harness',
		description: 'Start with a minimal Harness and configure its runtime in Prompt Lab.',
		action: 'Create Harness',
	},
	edit: {
		eyebrow: 'Harness details',
		title: 'Edit Details',
		description: 'Update its display identity without changing the stable Harness ID.',
		action: 'Save Changes',
	},
	duplicate: {
		eyebrow: 'New experiment',
		title: 'Duplicate Harness',
		description: 'Copy the configuration into a new Harness without copying runtime sessions.',
		action: 'Create Copy',
	},
};

function HarnessActionMenu({ harness, position, onClose, onEdit, onDuplicate, onDelete }) {
	return (
		<>
		<button
			type="button"
			className="harness-menu-backdrop"
			aria-label="Close Harness menu"
			onClick={onClose}
			onContextMenu={(event) => {
				event.preventDefault();
				onClose();
			}}
		/>
		<div className="harness-action-menu" style={{ left: position.x, top: position.y }} role="menu">
			<div className="harness-action-menu-heading">{harness.name || harness.id}</div>
			<button type="button" role="menuitem" onClick={onEdit}>
				<Pencil size={14} /> Edit details
			</button>
			<button type="button" role="menuitem" onClick={onDuplicate}>
				<Copy size={14} /> Duplicate
			</button>
			<div className="harness-action-menu-divider" />
			<button type="button" role="menuitem" className="danger" onClick={onDelete}>
				<Trash2 size={14} /> Delete
			</button>
		</div>
	</>
	);
}

function HarnessDialog({ dialog, error, submitting, onChange, onClose, onSubmit }) {
	const nameInputRef = useRef(null);
	const isDelete = dialog.mode === 'delete';
	const copy = DIALOG_COPY[dialog.mode];

	useEffect(() => {
		if (!isDelete) nameInputRef.current?.focus();
	}, [isDelete]);

	return (
		<div className="harness-dialog-layer" role="presentation" onMouseDown={(event) => {
			if (event.target === event.currentTarget && !submitting) onClose();
		}}>
			<section className={`harness-dialog ${isDelete ? 'harness-dialog-delete' : ''}`} role="dialog" aria-modal="true">
				<div className="harness-dialog-header">
					<div>
						<span className="harness-dialog-eyebrow">{isDelete ? 'Permanent action' : copy.eyebrow}</span>
						<h2>{isDelete ? 'Delete Harness?' : copy.title}</h2>
					</div>
					<button type="button" className="harness-dialog-close" onClick={onClose} disabled={submitting} title="Close">
						<X size={17} />
					</button>
				</div>

				{isDelete ? (
					<>
						<p className="harness-dialog-copy">
							Delete <strong>{dialog.draft.name}</strong> and its local session data. This cannot be undone.
						</p>
						<div className="harness-delete-identity">
							<FileCode2 size={17} />
							<div><strong>{dialog.draft.name}</strong><code>{dialog.sourceId}</code></div>
						</div>
					</>
				) : (
					<form id="harness-management-form" onSubmit={onSubmit}>
						<p className="harness-dialog-copy">{copy.description}</p>
						<label className="harness-field">
							<span>Name</span>
							<input
								ref={nameInputRef}
								value={dialog.draft.name}
								onChange={(event) => onChange('name', event.target.value)}
								placeholder="Research Harness"
								disabled={submitting}
							/>
						</label>
						<label className="harness-field">
							<span>Description <small>optional</small></span>
							<textarea
								value={dialog.draft.description}
								onChange={(event) => onChange('description', event.target.value)}
								placeholder="What is this Harness for?"
								rows={3}
								disabled={submitting}
							/>
						</label>
						<div className="harness-id-preview">
							<span>{dialog.mode === 'edit' ? 'Stable ID' : 'Generated ID'}</span>
							<code>{dialog.mode === 'edit' ? dialog.sourceId : (previewHarnessId(dialog.draft.name) || 'waiting-for-name')}</code>
						</div>
					</form>
				)}

				{error && <div className="harness-dialog-error" role="alert">{error}</div>}
				<div className="harness-dialog-actions">
					<button type="button" className="harness-button secondary" onClick={onClose} disabled={submitting}>Cancel</button>
					<button
						type={isDelete ? 'button' : 'submit'}
						form={isDelete ? undefined : 'harness-management-form'}
						className={`harness-button ${isDelete ? 'danger' : 'primary'}`}
						onClick={isDelete ? onSubmit : undefined}
						disabled={submitting || (!isDelete && !dialog.draft.name.trim())}
					>
						{submitting ? 'Working…' : (isDelete ? 'Delete Harness' : copy.action)}
					</button>
				</div>
			</section>
		</div>
	);
}

export function HarnessExplorer({
	harnesses,
	activeHarnessId,
	onSelect,
	onRefresh,
	onCreate,
	onEdit,
	onDuplicate,
	onDelete,
}) {
	const [state, setState] = useState(createHarnessExplorerState);
	const [submitting, setSubmitting] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [refreshError, setRefreshError] = useState('');
	const menuHarness = harnesses.find((item) => item.id === state.menu?.harnessId);

	const openDialog = (mode, harness) => setState((current) => openHarnessDialog(current, mode, harness));
	const openDelete = (harness) => setState((current) => openHarnessDelete(current, harness));
	const closeDialog = () => setState(closeHarnessDialog());

	const openMenu = (event, harnessId, anchor = null) => {
		event.preventDefault();
		event.stopPropagation();
		const menuWidth = 190;
		const menuHeight = 154;
		setState((current) => ({
			...current,
			menu: {
				harnessId,
				x: Math.max(8, Math.min(anchor?.x ?? event.clientX, window.innerWidth - menuWidth - 8)),
				y: Math.max(8, Math.min(anchor?.y ?? event.clientY, window.innerHeight - menuHeight - 8)),
			},
			error: '',
		}));
	};

	const handleRefresh = async () => {
		setRefreshing(true);
		setRefreshError('');
		const result = await onRefresh();
		if (!result) setRefreshError('Could not refresh Harnesses. Showing the last loaded list.');
		setRefreshing(false);
	};

	useEffect(() => {
		if (!state.dialog && !state.menu) return undefined;
		const handleKeyDown = (event) => {
			if (event.key !== 'Escape' || submitting) return;
			setState(closeHarnessDialog());
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [state.dialog, state.menu, submitting]);

	const updateDraft = (field, value) => {
		setState((current) => ({
			...current,
			dialog: {
				...current.dialog,
				draft: { ...current.dialog.draft, [field]: value },
			},
			error: '',
		}));
	};

	const submitDialog = async (event) => {
		event?.preventDefault();
		const { dialog } = state;
		if (!dialog) return;
		setSubmitting(true);
		setState((current) => ({ ...current, error: '' }));

		const payload = {
			id: dialog.sourceId,
			name: dialog.draft.name.trim(),
			description: dialog.draft.description.trim(),
		};
		const action = dialog.mode === 'create'
			? onCreate
			: dialog.mode === 'edit'
				? onEdit
				: dialog.mode === 'duplicate'
					? onDuplicate
					: onDelete;
		const result = await action(payload);
		setSubmitting(false);

		if (result?.ok) {
			closeDialog();
		} else {
			setState((current) => ({ ...current, error: result?.error || 'The operation could not be completed.' }));
		}
	};

	return (
		<aside className="sidebar harness-explorer">
			<div className="harness-explorer-header">
				<div>
					<span>Workspace</span>
					<h2>Harness Explorer</h2>
				</div>
				<div className="harness-explorer-header-actions">
					<button type="button" className="icon-btn" onClick={handleRefresh} title="Refresh Harnesses" disabled={refreshing}>
						<RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} />
					</button>
					<button type="button" className="icon-btn primary" onClick={() => openDialog('create')} title="Create Harness">
						<Plus size={16} />
					</button>
				</div>
			</div>
			{refreshError && <div className="harness-explorer-refresh-error" role="status">{refreshError}</div>}

			<div className="sidebar-list harness-explorer-list">
				{harnesses.map((harness) => (
					<div
						key={harness.id}
						id={`harness-${harness.id}`}
						className={`sidebar-item harness-explorer-item ${activeHarnessId === harness.id ? 'active' : ''}`}
						onClick={() => onSelect(harness.id)}
						onContextMenu={(event) => openMenu(event, harness.id)}
					>
						<span className="harness-explorer-file-icon"><FileCode2 size={15} /></span>
						<div className="sidebar-item-info">
							<HarnessIdentity harness={harness} compact />
							<div className="sidebar-item-desc" title={harness.description || 'No description'}>{harness.description || 'No description'}</div>
						</div>
						<button
							type="button"
							className="harness-item-menu-trigger"
							onClick={(event) => {
								const rect = event.currentTarget.getBoundingClientRect();
								openMenu(event, harness.id, { x: rect.right - 4, y: rect.bottom + 4 });
							}}
							title={`Manage ${harness.name || harness.id}`}
						>
							<MoreHorizontal size={16} />
						</button>
					</div>
				))}
				{harnesses.length === 0 && (
					<div className="harness-explorer-empty">
						<FileCode2 size={20} />
						<strong>No Harnesses yet</strong>
						<span>Create one to begin experimenting.</span>
					</div>
				)}
			</div>

			<div className="harness-explorer-footer">
				<span>{getHarnessCountLabel(harnesses.length)}</span>
				<span className="harness-local-status"><i /> local workspace</span>
			</div>

			{state.menu && menuHarness && (
				<HarnessActionMenu
					harness={menuHarness}
					position={state.menu}
					onClose={() => setState((current) => ({ ...current, menu: null }))}
					onEdit={() => openDialog('edit', menuHarness)}
					onDuplicate={() => openDialog('duplicate', menuHarness)}
					onDelete={() => openDelete(menuHarness)}
				/>
			)}

			{state.dialog && (
				<HarnessDialog
					dialog={state.dialog}
					error={state.error}
					submitting={submitting}
					onChange={updateDraft}
					onClose={closeDialog}
					onSubmit={submitDialog}
				/>
			)}
		</aside>
	);
}
