import path from 'path';
import { promises as fs } from 'fs';
import { OFFLOAD_THRESHOLD_BYTES, OFFLOAD_CLEANUP_AGE_MS } from '../AgentExecutor.js';

export const OutputOffloadPlugin = {
  name: 'OutputOffloadPlugin',

  async postToolUse(context) {
    const { tool } = context;
    const harnessId = context.executor.harnessId;

    if (
      tool.toolName !== 'read_file' &&
      typeof tool.toolOutput === 'string' &&
      Buffer.byteLength(tool.toolOutput, 'utf-8') > OFFLOAD_THRESHOLD_BYTES
    ) {
      try {
        const offloadedDir = path.join(process.cwd(), '.offloaded');
        await fs.mkdir(offloadedDir, { recursive: true });
        const offloadedFileName = `offload-${harnessId}-${tool.id}.txt`;
        const offloadedFilePath = path.join(offloadedDir, offloadedFileName);
        
        await fs.writeFile(offloadedFilePath, tool.toolOutput, 'utf-8');

        const originalSize = Buffer.byteLength(tool.toolOutput, 'utf-8');
        const headPreview = tool.toolOutput.slice(0, 1500);
        const tailPreview = tool.toolOutput.slice(-500);

        tool.toolOutput = `[OUTPUT OFFLOADED TO FILE: .offloaded/offload-${harnessId}-${tool.id}.txt (size: ${originalSize} bytes).
--- PREVIEW START (First 1500 chars) ---
${headPreview}
--- PREVIEW END ---
...[OUTPUT OFFLOADED - If you need the full content, use read_file tool on the offloaded path above]...
--- TAIL PREVIEW (Last 500 chars) ---
${tailPreview}
--- TAIL END ---]`;
      } catch (offloadErr) {
        console.error('[OutputOffloadPlugin] Failed to offload large tool output:', offloadErr);
      }
    }
  },

  async onLoopEnd(context) {
    // 静默执行过期 offload 文件清理
    try {
      const offloadedDir = path.join(process.cwd(), '.offloaded');
      try {
        await fs.access(offloadedDir);
      } catch {
        return; // Directory does not exist
      }

      const files = await fs.readdir(offloadedDir);
      for (const file of files) {
        if (!file.startsWith('offload-') || !file.endsWith('.txt')) continue;

        const filePath = path.join(offloadedDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (Date.now() - stat.mtime.getTime() > OFFLOAD_CLEANUP_AGE_MS) {
            await fs.unlink(filePath);
          }
        } catch (err) {
          if (err.code !== 'ENOENT') {
            console.error(`[OutputOffloadPlugin] Failed to process/delete file ${file}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('[OutputOffloadPlugin] Failed during offload cleanup:', err);
    }
  }
};
