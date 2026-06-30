import path from 'path';

// 硬拦截黑名单（直接拒绝，不弹窗）
const DENY_LIST = [
  'rm -rf /',
  'rm -rf *', // 避免在根目录误删
  'sudo ',
  'shutdown ',
  'reboot ',
  'mkfs ',
  'dd if=',
  '> /dev/',
  'chmod 777' // 危险的提权
];

function commandReferencesSensitiveFile(command) {
  const normalized = String(command || '');
  return (
    /(^|[^A-Za-z0-9_-])\.env(?:$|[^A-Za-z0-9_-])/.test(normalized) ||
    /\.(pem|key|p12|pfx)(?:$|[^A-Za-z0-9_-])/i.test(normalized)
  );
}

function markPermanentSecurityBlock(tool, reason) {
  tool.handled = true;
  tool.toolStatus = 'blocked';
  tool.securityBlock = {
    permanent: true,
    reason,
  };
}

// 需要用户确认的可疑规则
const SUSPICIOUS_RULES = [
  {
    tools: ['write_file'],
    check: (args) => {
      // 越界写入检测
      const filePath = args.path || args.filePath || '';
      if (!filePath) return false;
      const resolved = path.resolve(process.cwd(), filePath);
      return !resolved.startsWith(process.cwd());
    },
    message: '越界写入：试图在工作区（workspace）目录之外写入或修改文件。'
  },
  {
    tools: ['bash'],
    check: (args) => {
      const command = args.command || '';
      
      // 1. 重定向越界写盘检测
      const redirectRegex = />+\s*([^\s&|;<>]+)/g;
      let match;
      while ((match = redirectRegex.exec(command)) !== null) {
        const rawPath = match[1].replace(/['"]/g, '');
        if (rawPath === '/dev/null') continue;
        const resolved = path.resolve(process.cwd(), rawPath);
        if (!resolved.startsWith(process.cwd())) {
          return true; // 越界重定向写盘触发
        }
      }

      // 2. 命令行绝对路径参数审计（排除只读命令和命令本身）
      const absPathRegex = /(?:^|\s)(?:\/[^\s&|;<>]+)/g;
      let pathMatch;
      const cmdTrimmed = command.trim();
      while ((pathMatch = absPathRegex.exec(cmdTrimmed)) !== null) {
        const absPath = pathMatch[0].trim();
        const resolved = path.resolve(process.cwd(), absPath);
        const isCommandItself = cmdTrimmed.startsWith(absPath) || cmdTrimmed.startsWith('./' + absPath);
        
        if (!resolved.startsWith(process.cwd()) && absPath !== '/dev/null' && !isCommandItself) {
          const isReadOnlyCommand = cmdTrimmed.startsWith('cat ') || cmdTrimmed.startsWith('ls ') || cmdTrimmed.startsWith('grep ') || cmdTrimmed.startsWith('file ');
          if (!isReadOnlyCommand) {
            return true; // 引用越界绝对路径触发
          }
        }
      }

      // 3. 敏感 bash 操作检测：删除、提权、改变所有者、杀进程、外部连接/下载等
      const sensitiveKeywords = [
        'rm ',
        'chmod ',
        'chown ',
        'kill ',
        'ssh ',
        'curl ',
        'wget ',
        'systemctl ',
        'service ',
        'apt-get ',
        'yum ',
        'brew '
      ];
      return sensitiveKeywords.some(kw => command.includes(kw));
    },
    message: '高危命令或越界写入：检测到试图通过重定向往工作区外写入文件、引用越界绝对路径或者使用高危敏感 Bash 指令。'
  }
];

export const SecurityPlugin = {
  name: 'SecurityPlugin',

  // 存储所有挂起的审批 Promise 控制句柄
  // 键是 toolCallId，值是 { resolve, executor, timeoutId }
  pendingRequests: new Map(),

  async preToolUse(context) {
    const { executor, tool } = context;

    const securityMode = executor.features.security_mode || 'relaxed';

    const toolName = tool.toolName;
    const toolInput = tool.toolInput || {};

    // 1. 闸门一：硬拒绝检测 (Deny List & File IO Control via bash)
    if (toolName === 'bash') {
      const command = toolInput.command || '';
      const cmdTrimmed = command.trim();

      // A. 检测黑名单硬拒绝模式 (所有模式下均生效，防自杀)
      for (const pattern of DENY_LIST) {
        if (command.includes(pattern)) {
          console.warn(`⛔ [Security Blocked] 命中了黑名单硬拒绝模式: "${pattern}"`);
          tool.handled = true;
          tool.toolOutput = `⛔ [Security Blocked] The command '${command}' is permanently blocked by the system deny list.`;
          return;
        }
      }

      if (commandReferencesSensitiveFile(command)) {
        console.warn(`⛔ [Security Blocked] 拦截到试图通过 bash 访问敏感文件: "${command}"`);
        markPermanentSecurityBlock(tool, 'Sensitive file access is blocked by policy.');
        tool.toolOutput = `⛔ [Security Blocked] Sensitive file access is blocked for bash commands.`;
        return;
      }

      // B. 限制通过 bash 进行文件写入（含有重定向且非重定向到 /dev/null，或者含有常用的编辑器与写入命令）
      const hasWriteRedirect = />+\s*([^\s&|;<>]+)/.test(cmdTrimmed) && !/>\s*\/dev\/null/.test(cmdTrimmed);
      const hasFileWriteCommand = /\b(tee|sed\s+-i|vi|vim|nano)\b/.test(cmdTrimmed);
      if (hasWriteRedirect || hasFileWriteCommand) {
        console.warn(`⛔ [Security Blocked] 拦截到试图通过 bash 写入文件: "${command}"`);
        tool.handled = true;
        tool.toolOutput = `⛔ [Security Blocked] File writing operations are strictly prohibited via bash tool. Please use 'write_file' tool instead.`;
        return;
      }

      // C. 限制通过 bash 进行文件读取（含有常用的读取指令作为命令开头）
      const hasFileReadCommand = /^\s*(cat|head|tail|less|more)\b/.test(cmdTrimmed);
      if (hasFileReadCommand) {
        console.warn(`⛔ [Security Blocked] 拦截到试图通过 bash 读取文件: "${command}"`);
        tool.handled = true;
        tool.toolOutput = `⛔ [Security Blocked] File reading operations are strictly prohibited via bash tool. Please use 'read_file' tool instead.`;
        return;
      }
    }

    // 如果安全模式为 full (Level 0)，越过人工审批直接放行
    if (securityMode === 'full') {
      return;
    }

    // 2. 闸门二：敏感规则扫描，判断是否需要人工审批
    let matchedReason = null;

    if (securityMode === 'strict') {
      // 严格模式 (Level 2: Fail-Closed 白名单)
      if (toolName === 'bash') {
        const command = toolInput.command || '';
        const cmdTrimmed = command.trim();
        // 白名单：只有纯粹的读取和状态查看命令直接放行
        const isSafeRead = /^\s*(ls|pwd|echo|git\s+status|git\s+diff|git\s+log|file)\b/.test(cmdTrimmed) && !cmdTrimmed.includes('>');
        if (!isSafeRead) {
          matchedReason = '严格安全模式 (Fail-Closed)：拦截到非纯粹读取性质的 Bash 命令，需要人工确认其副作用。';
        }
      } else if (['write_file', 'replace_file_content', 'multi_replace_file_content', 'run_command'].includes(toolName)) {
        // 所有修改性质的专属工具均要求审批
        matchedReason = `严格安全模式 (Fail-Closed)：拦截到修改工作区状态的高危工具 [${toolName}]，需要人工确认。`;
      }
    } else {
      // 宽松模式 (Level 1: Relaxed 灰名单)
      for (const rule of SUSPICIOUS_RULES) {
        if (rule.tools.includes(toolName) && rule.check(toolInput)) {
          matchedReason = rule.message;
          break;
        }
      }
    }

    // 如果未命中规则（比如纯安全的读取），直接放行
    if (!matchedReason) {
      return;
    }

    // 3. 闸门三：用户审批（异步挂起）
    console.log(`⚠️  [Security Warning] 触发安全检查拦截: ${matchedReason}. 等待用户授权...`);

    // 设置 Executor 上挂起的权限请求状态，以便状态接口返回给前端做断点连接恢复
    const pendingRequestInfo = {
      toolCallId: tool.id,
      toolName,
      toolInput,
      reason: matchedReason
    };
    executor.pendingPermission = pendingRequestInfo;

    // 广播 `permission_request` SSE 事件给前端
    executor.onEvent('permission_request', pendingRequestInfo);

    // 阻塞挂起当前工具调用
    const decision = await new Promise((resolve) => {
      // 5分钟超时保护，超时默认判定为拒绝
      const timeoutId = setTimeout(() => {
        console.warn(`⏰ [Security Timeout] 授权审批已超时(5分钟)，默认自动拒绝: ${tool.id}`);
        resolve('deny');
      }, 5 * 60 * 1000);

      this.pendingRequests.set(tool.id, {
        resolve,
        executor,
        timeoutId
      });
    });

    // 清理挂起状态
    executor.pendingPermission = null;
    executor.onEvent('permission_resolved', {
      toolCallId: tool.id,
      toolName,
      decision,
    });

    if (decision === 'deny') {
      console.log(`❌ [Security Authorization] 用户拒绝了此操作: ${tool.id}`);
      tool.handled = true;
      tool.toolOutput = '⛔ [Permission Denied] The user rejected this tool call.';
    } else {
      console.log(`✅ [Security Authorization] 用户批准了此操作，继续执行: ${tool.id}`);
    }
  },

  /**
   * 提交用户的授权决定
   * @param {string} toolCallId
   * @param {string} decision 'allow' | 'deny'
   */
  resolvePermission(toolCallId, decision) {
    const pending = this.pendingRequests.get(toolCallId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(toolCallId);
      pending.resolve(decision);
      return true;
    }
    return false;
  },

  /**
   * 清理指定 Executor 的所有 pending 权限（防止泄漏）
   */
  clearExecutorPending(executor) {
    for (const [id, req] of this.pendingRequests.entries()) {
      if (req.executor === executor) {
        clearTimeout(req.timeoutId);
        req.resolve('deny'); // 默认拒绝
        this.pendingRequests.delete(id);
      }
    }
  }
};
