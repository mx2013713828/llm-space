const PERMISSION_FIELDS = [
	'toolCallId',
	'toolName',
	'toolInput',
	'reason',
	'runtimeRole',
	'childType',
	'childId',
	'name',
	'role',
	'parentToolCallId',
	'teamId',
	'teammateId',
	'teammateName',
	'teammateRole',
];

function pickDefinedFields(source, fields) {
	const output = {};
	for (const field of fields) {
		if (source?.[field] !== undefined) {
			output[field] = source[field];
		}
	}
	return output;
}

export function normalizePermissionPayload(event = {}) {
	return pickDefinedFields(event, PERMISSION_FIELDS);
}

export function getPermissionSourcePresentation(permission = {}) {
	const childType = permission.childType || permission.runtimeRole;

	if (childType === 'teammate' || permission.teammateId || permission.teammateName) {
		return {
			visible: true,
			label: 'Teammate',
			title: permission.teammateName || permission.name || permission.teammateId || permission.childId || 'unknown',
			detail: permission.teammateRole || permission.role || '',
			tone: 'blue',
		};
	}

	if (childType === 'sub_agent') {
		return {
			visible: true,
			label: 'Sub-agent',
			title: permission.name || permission.childId || permission.parentToolCallId || 'unknown',
			detail: permission.parentToolCallId ? `Parent tool: ${permission.parentToolCallId}` : '',
			tone: 'purple',
		};
	}

	return {
		visible: false,
		label: 'Lead agent',
		title: 'Lead agent',
		detail: '',
		tone: 'neutral',
	};
}
