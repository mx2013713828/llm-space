import process from 'node:process';
import { composeSystemPromptSections } from './promptAssembly/promptAssembly.js';

const PLATFORM_NAMES = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

function formatDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function getRuntimeMetadata({
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  platform = process.platform,
  arch = process.arch,
  cwd = process.cwd(),
} = {}) {
  return {
    date: formatDateInTimeZone(now, timeZone),
    timezone: timeZone,
    operatingSystem: PLATFORM_NAMES[platform] || platform,
    architecture: arch,
    workingDirectory: cwd,
  };
}

export function formatRuntimeContext(metadata) {
  return [
    '<runtime_context>',
    `  <date>${escapeXml(metadata.date)}</date>`,
    `  <timezone>${escapeXml(metadata.timezone)}</timezone>`,
    `  <operating_system>${escapeXml(metadata.operatingSystem)}</operating_system>`,
    `  <architecture>${escapeXml(metadata.architecture)}</architecture>`,
    `  <working_directory>${escapeXml(metadata.workingDirectory)}</working_directory>`,
    '</runtime_context>',
  ].join('\n');
}

export function composeSystemPrompt(systemPrompt, runtimeContext) {
  return composeSystemPromptWithSections({
    agentGuidance: systemPrompt,
    runtimeContext,
  }).text;
}

export function composeSystemPromptWithSections({
  agentGuidance = '',
  guidanceFile = '',
  runtimeContext = '',
} = {}) {
  return composeSystemPromptSections({
    agentGuidance,
    guidanceFile,
    runtimeContext,
  });
}
