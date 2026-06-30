export function handleLegacyChatRoute(_req, res) {
  return res.status(410).json({
    error: 'Legacy /api/chat is disabled. Use /api/agent/run instead.',
  });
}
