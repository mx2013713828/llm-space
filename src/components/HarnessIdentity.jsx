import { getHarnessPresentation } from '../lib/harnessPresentation.js';

export function HarnessIdentity({ harness, compact = false, className = '', label = 'Current harness' }) {
	const presentation = getHarnessPresentation(harness);
	return (
		<div className={`harness-identity ${compact ? 'compact' : ''} ${className}`.trim()} title={presentation.title}>
			{!compact && <span className="harness-identity-label">{label}</span>}
			<strong className="harness-identity-name">{presentation.primary}</strong>
			<span className="harness-identity-id">{presentation.secondary}</span>
		</div>
	);
}
