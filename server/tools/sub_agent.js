/**
 * sub_agent 工具
 * 允许主 Agent 派发一个拥有独立上下文的子代理去完成特定任务。
 * 纯前端拦截工具，后端仅作 schema 注册。
 */
const subAgent = {
  name: 'sub_agent',
  description: 'Delegate a complex sub-task to a Sub-agent. The Sub-agent will start a completely new, clean context with no conversation history, and return a final summary when finished. Best used when you need extensive information gathering or multi-step experimentation without polluting your current memory with lengthy intermediate outputs. **WARNING: Since the sub-agent has NO context memory, you MUST explain the full context and background in the prompt.**',
  parameters: {
    prompt: {
      type: 'string',
      description: 'Detailed instructions for the sub-agent. **CRITICALLY IMPORTANT**: The sub-agent has NO history of the main conversation! You MUST provide all necessary background information (e.g., current file paths, relevant code snippets, error messages, or conclusions you have reached) and clear acceptance criteria explicitly in this prompt.',
      required: true,
    },
  },
  async execute({ prompt }) {
    // 真正的逻辑在前端 TrajectoryPage.jsx 中拦截执行
    return "Sub-agent execution completed (backend fallback return, if you see this, the frontend failed to intercept the call)";
  },
};

export default subAgent;
