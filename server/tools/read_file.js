import { promises as fs } from 'fs';
import path from 'path';

export default {
  name: 'read_file',
  description: 'Read the contents of a file from the local filesystem.',
  parameters: {
    path: { type: 'string', description: 'Absolute or relative path to the file', required: true }
  },
  execute: async (params) => {
    try {
      const filePath = params.path || params.filePath;
      if (!filePath) throw new Error('Missing parameter: path or filePath');
      const targetPath = path.resolve(process.cwd(), filePath);
      const content = await fs.readFile(targetPath, 'utf-8');
      return content;
    } catch (error) {
      return `Failed to read file: ${error.message}`;
    }
  }
};
