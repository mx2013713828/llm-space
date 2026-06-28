# Schema 声明驱动的实验特性管理系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现实验特性的解耦管理与二级细分开关（包括软/硬压缩、思维链折叠、物理落盘），构建通用的声明式 Schema 驱动模版。

**Architecture:** 
1. 共享元数据定义 [FeatureSchema.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/lib/FeatureSchema.js)。
2. 后端防御性数据过滤器 [FeatureParser.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/FeatureParser.js)，提供向下兼容翻译及 Fail-Closed 降级保障。
3. 前端联动表单渲染器，防止数据幽灵残留。

**Tech Stack:** Node.js, ESM, React

---

### Task 1: 共享元数据定义 [NEW] [FeatureSchema.js]

**Files:**
- Create: [FeatureSchema.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/lib/FeatureSchema.js)

- [ ] **Step 1: 创建 Schema 元数据定义文件**

写入如下声明结构：
```javascript
export const FEATURE_SCHEMA = {
  enable_security: {
    type: 'boolean',
    label: '安全防护与规则审批防线',
    description: '拦截高危命令与越界文件写入操作，并通过前端弹窗获取授权。',
    defaultValue: false,
    failSafeValue: true // 安全关键特性：解析损坏或异常时，默认 Fail-Closed 强行拦截防护
  },
  context_compaction: {
    type: 'group',
    label: '上下文优化与提示词缓存管理',
    description: '在大项目调试、多轮对话时，通过不同策略管理 Token 水位与优化响应速度。',
    defaultValue: true,
    failSafeValue: false, // 辅助特性：异常时 Fail-Open 关闭，避免干扰正常执行
    children: {
      soft_compact: {
        type: 'boolean',
        label: '软清洗老历史文件 (Soft-Compact)',
        description: '对 5 轮前的 read_file/write_file/ls/grep/bash 内容进行静默掏空折叠。',
        defaultValue: true,
        failSafeValue: false
      },
      hard_compact: {
        type: 'boolean',
        label: '大模型语义记忆重构 (Hard-Compact)',
        description: '在 Token 极度溢出时触发 LLM 自动生成历史记忆摘要，重建核心上下文。',
        defaultValue: true,
        failSafeValue: false
      },
      thinking_compaction: {
        type: 'boolean',
        label: '实时折叠已决思维链 (Thinking Compaction)',
        description: '在工具调用返回结果后，将冗长的 thinking 块折叠为轻量占位符 [Thinking folded]。',
        defaultValue: true,
        failSafeValue: false
      },
      output_offload: {
        type: 'boolean',
        label: '超长工具输出物理落盘 (Large Output Offload)',
        description: '将超过 20KB 限制的工具执行结果自动转存到本地 .offloaded 临时目录中。',
        defaultValue: true,
        failSafeValue: false
      }
    }
  }
};
```

- [ ] **Step 2: 验证文件导入无语法错误**

Run: `node -e "import('./src/lib/FeatureSchema.js').then(() => console.log('PASS'))"`
Expected: PASS

---

### Task 2: 后端数据防御解析与兼容机制 [NEW] [FeatureParser.js]

**Files:**
- Create: [FeatureParser.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/FeatureParser.js)
- Test: [test-schema-features.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/scratch/test-schema-features.js)

- [ ] **Step 1: 实现后端解析核心函数**

创建并编写 [FeatureParser.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/FeatureParser.js)：
```javascript
import { FEATURE_SCHEMA } from '../../../src/lib/FeatureSchema.js';

/**
  * parseFeatures - 依据 Schema 解析、补全、翻译并做 Fail-Safe 熔断降级
  * @param {Object} inputFeatures 用户传入的 features 配置对象
  * @returns {Object} 规范解析后的 features
  */
export function parseFeatures(inputFeatures) {
  try {
    const parsed = {};
    for (const [key, meta] of Object.entries(FEATURE_SCHEMA)) {
      const userVal = inputFeatures?.[key];

      if (meta.type === 'boolean') {
        parsed[key] = userVal !== undefined ? !!userVal : meta.defaultValue;
      } else if (meta.type === 'group') {
        parsed[key] = {};
        // 判定父开关状态，兼容旧版 boolean 数据格式的输入
        const isGroupEnabled = typeof userVal === 'boolean'
          ? userVal
          : (userVal?.enabled !== undefined ? !!userVal.enabled : meta.defaultValue);

        parsed[key].enabled = isGroupEnabled;

        // 填充子开关，并支持向下兼容解析
        for (const [subKey, subMeta] of Object.entries(meta.children)) {
          let subVal;
          if (typeof userVal === 'boolean') {
            // 如果旧版数据中父开关是一个布尔值（如 context_compaction: true），子特性开关与其保持完全同步
            subVal = userVal;
          } else {
            subVal = userVal?.[subKey];
          }

          // 核心防御点：如果父开关处于关闭状态，无论如何子特性值在运行时一律强制输出为 false
          parsed[key][subKey] = isGroupEnabled
            ? (subVal !== undefined ? !!subVal : subMeta.defaultValue)
            : false;
        }
      }
    }
    return parsed;
  } catch (err) {
    console.error('[FeatureParser] 遇到异常损坏数据，拉起 Fail-Safe 熔断降级:', err);
    // 熔断保护：强制降级为 failSafeValue
    const failSafeData = {};
    for (const [key, meta] of Object.entries(FEATURE_SCHEMA)) {
      if (meta.type === 'boolean') {
        failSafeData[key] = meta.failSafeValue;
      } else if (meta.type === 'group') {
        failSafeData[key] = { enabled: meta.failSafeValue };
        for (const [subKey, subMeta] of Object.entries(meta.children)) {
          failSafeData[key][subKey] = meta.failSafeValue;
        }
      }
    }
    return failSafeData;
  }
}
```

- [ ] **Step 2: 编写专属解析单元测试**

创建测试脚本 [test-schema-features.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/scratch/test-schema-features.js)：
```javascript
import assert from 'assert';
import { parseFeatures } from '../server/agent/FeatureParser.js';

function runTests() {
  console.log('🧪 开始解析器兼容性与 Fail-Safe 单元测试...');

  // 1. 验证空值与默认值填充
  const emptyResult = parseFeatures(undefined);
  assert.strictEqual(emptyResult.enable_security, false, '默认值应为 false');
  assert.strictEqual(emptyResult.context_compaction.enabled, true, '父开关默认应为 true');
  assert.strictEqual(emptyResult.context_compaction.soft_compact, true, '子特性默认应为 true');

  // 2. 验证向下兼容 (旧版扁平 boolean 映射)
  const legacyTrue = parseFeatures({ context_compaction: true });
  assert.strictEqual(legacyTrue.context_compaction.enabled, true, '旧数据 true 应翻译为 enabled = true');
  assert.strictEqual(legacyTrue.context_compaction.soft_compact, true, '旧数据 true 时子开关应为 true');

  const legacyFalse = parseFeatures({ context_compaction: false });
  assert.strictEqual(legacyFalse.context_compaction.enabled, false, '旧数据 false 应翻译为 enabled = false');
  assert.strictEqual(legacyFalse.context_compaction.soft_compact, false, '旧数据 false 时子开关必须强制为 false');

  // 3. 验证父开关关闭时的子开关强制只读防护 (防止脏残留溢出)
  const forceFalseResult = parseFeatures({
    context_compaction: {
      enabled: false,
      soft_compact: true, // 虽然写了 true，但因为父开关为 false，应被强制覆写为 false
      hard_compact: true
    }
  });
  assert.strictEqual(forceFalseResult.context_compaction.soft_compact, false, '父开关关闭时，子开关必须强制覆盖为 false');

  // 4. 验证畸形、损坏数据引发崩溃时的 Fail-Safe 熔断降级
  // 传入一个能够让遍历或属性访问抛出异常的恶意 Proxy
  const poisonData = new Proxy({}, {
    get(target, prop) {
      if (prop === 'enable_security') throw new Error('Poison Access');
      return undefined;
    }
  });
  const failSafeResult = parseFeatures(poisonData);
  assert.strictEqual(failSafeResult.enable_security, true, '解析异常时，安全相关特性应熔断为 Fail-Closed (true)');
  assert.strictEqual(failSafeResult.context_compaction.enabled, false, '解析异常时，辅助功能应降级为 Fail-Open (false)');

  console.log('✅ 解析器单元测试全部通过！');
}

runTests();
```

- [ ] **Step 3: 运行解析单元测试**

Run: `node scratch/test-schema-features.js`
Expected: PASS

---

### Task 3: 后端 AgentExecutor 拦截与插件解耦

**Files:**
- Modify: [AgentExecutor.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js)

- [ ] **Step 1: 引入 FeatureParser 并解析 features**

修改 [AgentExecutor.js:8-13](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js#L8-L13)，添加 `parseFeatures` 导入，并在构造函数中对 `features` 进行解析保底：

```diff
 import { HookManager } from './HookManager.js';
 import { CompactionPlugin } from './plugins/CompactionPlugin.js';
 import { TodoNagPlugin } from './plugins/TodoNagPlugin.js';
 import { OutputOffloadPlugin } from './plugins/OutputOffloadPlugin.js';
 import { SubAgentPlugin } from './plugins/SubAgentPlugin.js';
 import { SkillsPlugin } from './plugins/SkillsPlugin.js';
 import { SecurityPlugin } from './plugins/SecurityPlugin.js';
+import { parseFeatures } from './FeatureParser.js';
```

修改 [AgentExecutor.js:62](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js#L62) 赋值处：
```diff
-    this.features = features;
+    this.features = parseFeatures(features);
```

- [ ] **Step 2: 调整插件注册逻辑**

修改 [AgentExecutor.js:89-97](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js#L89-L97)，解耦 `CompactionPlugin` 和 `OutputOffloadPlugin` 的注册条件：

```diff
-    if (this.features.context_compaction !== false) {
+    if (this.features.context_compaction && this.features.context_compaction.enabled) {
       this.hooks.register(CompactionPlugin);
     }
     if (this.features.todo_nag !== false) {
       this.hooks.register(TodoNagPlugin);
     }
-    if (this.features.output_offload !== false) {
+    if (this.features.context_compaction && this.features.context_compaction.enabled && this.features.context_compaction.output_offload) {
       this.hooks.register(OutputOffloadPlugin);
     }
```

- [ ] **Step 3: 运行解析单元测试，验证 Executor 实例化不受影响**

Run: `node scratch/test-schema-features.js`
Expected: PASS

---

### Task 4: 各类优化逻辑与插件的细分开关绑定

**Files:**
- Modify: [CompactionPlugin.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/plugins/CompactionPlugin.js)
- Modify: [messageBuilder.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/lib/messageBuilder.js)

- [ ] **Step 1: 解耦 CompactionPlugin 中的软清洗与硬重构**

修改 [CompactionPlugin.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/plugins/CompactionPlugin.js#L14-L40)，仅在相应的子开关打开时，才分别执行软、硬压缩：

```diff
     let shouldTrySoft = true;
+    // 必须确保软清洗子特性已开启
+    if (!executor.features?.context_compaction?.soft_compact) {
+      shouldTrySoft = false;
+    }
     if (executor.lastSoftCompactTurn !== undefined && (turnIndex - executor.lastSoftCompactTurn) < cooldown) {
       shouldTrySoft = false;
       console.log(`[CompactionPlugin] 距离上次软清洗不到 ${cooldown} 轮 (当前: ${turnIndex}, 上次: ${executor.lastSoftCompactTurn})，跳过软清洗。`);
     }
```

修改 [CompactionPlugin.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/plugins/CompactionPlugin.js#L52) 处的 hard_compact 部分：
```diff
     // 2. Hard Compact Stage 2
     const tokensAfterSoft = executor.contextTokens > 0 ? executor.contextTokens : executor.estimateCurrentTokens();
-    if (executor.compactionEnabled && tokensAfterSoft > HARD_COMPACT_TOKEN_THRESHOLD && !executor.hardCompactTriggered && executor.messages.length > 10) {
+    if (executor.compactionEnabled && executor.features?.context_compaction?.hard_compact && tokensAfterSoft > HARD_COMPACT_TOKEN_THRESHOLD && !executor.hardCompactTriggered && executor.messages.length > 10) {
```

- [ ] **Step 2: 解耦 messageBuilder 中的思维链折叠**

修改 [messageBuilder.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/lib/messageBuilder.js#L77)，在 `buildApiMessages` 中折叠 `thinking` 块时，判断 `thinking_compaction` 子开关：

修改前：
```javascript
        if (compactionEnabled && !shouldKeepThinking(msg, idx)) {
          thinkingContent = '[Thinking folded]';
        }
```

修改后（因为 `compactionEnabled` 可以作为大开关，但我们此时需要读取到 `thinking_compaction` 子开关。不过 `buildApiMessages` 在后端接收的第三个参数是 `compactionEnabled` 布尔值。我们需要将 `features` 配置直接透传，或者进行自适应。由于 `buildApiMessages` 在前端和后端都使用，为保持通用性，可将第三个参数扩充为支持传入 `features` 配置对象，或者进行属性探查）：

```javascript
        // compactionEnabled 可以是一个布尔值（向下兼容），也可以是一个配置对象
        const isThinkingCompactionEnabled = typeof compactionEnabled === 'object'
          ? (compactionEnabled.enabled && compactionEnabled.thinking_compaction)
          : !!compactionEnabled;

        if (isThinkingCompactionEnabled && !shouldKeepThinking(msg, idx)) {
          thinkingContent = '[Thinking folded]';
        }
```

同时修改 [AgentExecutor.js:232](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js#L232) 传递参数：
```diff
-          apiMessages: buildApiMessages(this.messages, this.thinkingEnabled, this.compactionEnabled),
+          apiMessages: buildApiMessages(this.messages, this.thinkingEnabled, this.features.context_compaction),
```
以及 [AgentExecutor.js:151](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js#L151) 传递参数：
```diff
-      this.compactionEnabled
+      this.features.context_compaction
```

- [ ] **Step 3: 运行所有软硬压缩的集成测试**

Run: `node scratch/test-compact-offload.js && node scratch/test-compact-optimization.js`
Expected: PASS

---

### Task 5: 前端 UI 动态配置面板开发与幽灵状态清理

**Files:**
- Modify: [PromptLabPage.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/pages/PromptLabPage.jsx)
- Modify: [useAgentLoop.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/hooks/useAgentLoop.js)

- [ ] **Step 1: 将 FeatureSchema 引入前端并重构 PromptLabPage.jsx 配置渲染**

修改 [PromptLabPage.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/pages/PromptLabPage.jsx)，导入 `FEATURE_SCHEMA` 并替换原有硬编码的 checkbox 组件。
实现带有“幽灵状态清理”的开关逻辑：

```javascript
import { FEATURE_SCHEMA } from '../lib/FeatureSchema.js';

// 处理父级特性的开关变化
const handleFeatureChange = (key, val) => {
  setFeatures(prev => {
    const updated = { ...prev };
    const meta = FEATURE_SCHEMA[key];
    
    if (meta.type === 'boolean') {
      updated[key] = val;
    } else if (meta.type === 'group') {
      updated[key] = {
        enabled: val,
        // 如果开启，保持原有或使用默认值；如果关闭，重置所有子开关为官方默认值防止脏残留
        ...Object.keys(meta.children).reduce((acc, subKey) => {
          acc[subKey] = val 
            ? (prev[key]?.[subKey] ?? meta.children[subKey].defaultValue)
            : meta.children[subKey].defaultValue;
          return acc;
        }, {})
      };
    }
    return updated;
  });
};

// 处理二级特性的开关变化
const handleSubFeatureChange = (parentKey, subKey, val) => {
  setFeatures(prev => ({
    ...prev,
    [parentKey]: {
      ...prev[parentKey],
      [subKey]: val
    }
  }));
};
```

动态渲染 UI 面板代码：
```jsx
{Object.entries(FEATURE_SCHEMA).map(([key, meta]) => {
  if (meta.type === 'boolean') {
    return (
      <div key={key} className="feature-item p-4 border rounded bg-white/5 backdrop-blur-sm">
        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={!!features[key]}
            onChange={(e) => handleFeatureChange(key, e.target.checked)}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <div>
            <span className="font-semibold text-white">{meta.label}</span>
            <p className="text-xs text-gray-400">{meta.description}</p>
          </div>
        </label>
      </div>
    );
  } else if (meta.type === 'group') {
    const isParentEnabled = !!(features[key]?.enabled ?? features[key]);
    return (
      <div key={key} className="feature-group-item p-4 border rounded bg-white/5 backdrop-blur-md space-y-4">
        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isParentEnabled}
            onChange={(e) => handleFeatureChange(key, e.target.checked)}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <div>
            <span className="font-semibold text-white">{meta.label}</span>
            <p className="text-xs text-gray-400">{meta.description}</p>
          </div>
        </label>

        {/* 二级选项缩进展示 */}
        <div className={`pl-8 space-y-3 transition-opacity duration-200 ${isParentEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
          {Object.entries(meta.children).map(([subKey, subMeta]) => {
            const isSubEnabled = isParentEnabled && !!features[key]?.[subKey];
            return (
              <label key={subKey} className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!isParentEnabled}
                  checked={isSubEnabled}
                  onChange={(e) => handleSubFeatureChange(key, subKey, e.target.checked)}
                  className="rounded border-gray-300 text-indigo-500 focus:ring-indigo-400"
                />
                <div>
                  <span className="text-sm font-medium text-gray-200">{subMeta.label}</span>
                  <p className="text-xs text-gray-500">{subMeta.description}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
})}
```

- [ ] **Step 2: 修改 useAgentLoop.js 中的初始化逻辑**

修改 [useAgentLoop.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/hooks/useAgentLoop.js)，使用 Schema 中声明的默认配置填充初始的 `features` 状态：

```javascript
import { FEATURE_SCHEMA } from '../lib/FeatureSchema.js';

export const getInitialFeatures = () => {
  const initial = {};
  for (const [key, meta] of Object.entries(FEATURE_SCHEMA)) {
    if (meta.type === 'boolean') {
      initial[key] = meta.defaultValue;
    } else if (meta.type === 'group') {
      initial[key] = {
        enabled: meta.defaultValue,
        ...Object.keys(meta.children).reduce((acc, subKey) => {
          acc[subKey] = meta.children[subKey].defaultValue;
          return acc;
        }, {})
      };
    }
  }
  return initial;
};
```

并在 `useAgentLoop` 组件中：
```javascript
const [features, setFeatures] = useState(() => getInitialFeatures());
```

- [ ] **Step 3: 运行 ESLint 静态语法扫描，验证语法正确性**

Run: `npm run lint`
Expected: PASS
