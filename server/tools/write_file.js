import { promises as fs } from 'fs';
import path from 'path';

import { resolveToolPathForWrite } from './pathPolicy.js';

export default {
  name: 'write_file',
  description: 'Write or overwrite contents into a file on the local filesystem.',
  parameters: {
    path: { type: 'string', description: 'Absolute or relative path to the file', required: true },
    content: { type: 'string', description: 'The exact content to write to the file', required: true }
  },
  execute: async (params) => {
    try {
      const filePath = params.path || params.filePath;
      const content = params.content;
      const targetPath = resolveToolPathForWrite(filePath);
      // Ensure directory exists
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, 'utf-8');
      return `Successfully wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${filePath}`;
    } catch (error) {
      return `Failed to write file: ${error.message}`;
    }
  }
};
