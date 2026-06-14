import { spawn } from 'child_process';

export default {
  name: 'bash',
  description: 'Execute a shell command. Use this to run scripts, navigate the filesystem, or interact with the OS.',
  parameters: {
    command: { type: 'string', description: 'The bash command to execute', required: true },
    run_in_background: { type: 'boolean', description: 'Whether to run the command in the background without waiting for it to finish. Useful for long-running processes like npm install, python scripts, server starts.', required: false }
  },
  /**
   * 执行逻辑支持流式回调
   * @param {Object} params 参数
   * @param {Function} onData 可选的流式输出回调 (chunk: string) => void
   */
  execute: async ({ command }, onData) => {
    return new Promise((resolve) => {
      // 注入环境变量，诱导工具产生彩色输出和进度条
      const env = { 
        ...process.env, 
        FORCE_COLOR: '1', 
        PYTHONUNBUFFERED: '1',
        PIP_PROGRESS_BAR: 'on',
        TERM: 'xterm-256color' 
      };

      const child = spawn('bash', ['-c', command], { env });
      
      let fullOutput = '';

      const handleData = (data) => {
        const chunk = data.toString();
        fullOutput += chunk;
        if (onData) onData(chunk);
      };

      child.stdout.on('data', handleData);
      child.stderr.on('data', handleData);

      child.on('close', (code) => {
        if (code !== 0 && !fullOutput) {
          resolve(`[ERROR] Process exited with code ${code}`);
        } else {
          resolve(fullOutput || 'Command executed successfully.');
        }
      });

      child.on('error', (err) => {
        resolve(`[LAUNCH ERROR] ${err.message}`);
      });
      
      // 设置一个总的安全超时（防止进程死掉）
      setTimeout(() => {
        child.kill();
        resolve(fullOutput + '\n[TIMEOUT] Process killed after 2 minutes.');
      }, 120000);
    });
  }
};
