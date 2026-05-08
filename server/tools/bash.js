import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export default {
  name: 'bash',
  description: 'Execute a shell command. Use this to run scripts, navigate the filesystem, or interact with the OS.',
  parameters: {
    command: { type: 'string', description: 'The bash command to execute', required: true }
  },
  execute: async ({ command }) => {
    try {
      // 增加超时控制，防止长期阻塞 (例如 30 秒超时)
      const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
      let output = '';
      if (stdout) output += `[STDOUT]\n${stdout}\n`;
      if (stderr) output += `[STDERR]\n${stderr}\n`;
      return output.trim() || 'Command executed successfully with no output.';
    } catch (error) {
      return `[ERROR]\n${error.message}\n${error.stdout ? `\n[STDOUT]\n${error.stdout}` : ''}${error.stderr ? `\n[STDERR]\n${error.stderr}` : ''}`;
    }
  }
};
