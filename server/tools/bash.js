import { spawn } from 'child_process';

export default {
  name: 'bash',
  description: 'Execute a shell command. Use this to run scripts, navigate the filesystem, or interact with the OS. CRITICAL: When running commands like npm install, apt-get, or any package manager, ALWAYS use non-interactive flags (e.g., -y, --quiet). The system will strictly kill any process that stalls on an interactive prompt.',
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
      let lastOutputTime = Date.now();

      const handleData = (data) => {
        lastOutputTime = Date.now();
        const chunk = data.toString();
        fullOutput += chunk;
        if (onData) onData(chunk);
      };

      child.stdout.on('data', handleData);
      child.stderr.on('data', handleData);

      // 45-second Stall Watchdog
      const stallCheckInterval = setInterval(() => {
        if (Date.now() - lastOutputTime > 45000) {
          clearInterval(stallCheckInterval);
          clearTimeout(hardTimeout);
          
          const lastChars = fullOutput.trim().slice(-100).toLowerCase();
          const isPrompt = /\[y\/n\]|\(y\/n\)|password:|please select:|choose:|continue\?/i.test(lastChars);
          
          child.kill('SIGKILL');
          let msg = '\n[STALL WATCHDOG] Process killed due to 45 seconds of inactivity.';
          if (isPrompt) {
            msg += ' Detected possible interactive prompt. You MUST retry with non-interactive flags (e.g., -y).';
          }
          resolve(fullOutput + msg);
        }
      }, 5000);

      child.on('close', (code) => {
        clearInterval(stallCheckInterval);
        clearTimeout(hardTimeout);
        if (code !== 0 && !fullOutput) {
          resolve(`[ERROR] Process exited with code ${code}`);
        } else {
          resolve(fullOutput || 'Command executed successfully.');
        }
      });

      child.on('error', (err) => {
        clearInterval(stallCheckInterval);
        clearTimeout(hardTimeout);
        resolve(`[LAUNCH ERROR] ${err.message}`);
      });
      
      // 设置一个总的安全超时（防止进程死掉）
      const hardTimeout = setTimeout(() => {
        clearInterval(stallCheckInterval);
        child.kill('SIGKILL');
        resolve(fullOutput + '\n[TIMEOUT] Process killed after 2 minutes.');
      }, 120000);
    });
  }
};
