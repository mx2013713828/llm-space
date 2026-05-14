export default {
  name: 'web_search',
  description: '搜索互联网获取最新信息。返回结构化结果，包含标题、URL、内容摘要。适用场景：需要实时信息、新闻、数据查询。',
  parameters: {
    query: {
      type: 'string',
      description: '搜索关键词或问题（建议用简洁的自然语言描述）',
      required: true
    }
  },
  execute: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return '[错误] 未配置 TAVILY_API_KEY，请在 .env 中设置。';

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        max_results: 5,
        search_depth: 'basic',
        include_answer: 'basic',
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return `[搜索失败] HTTP ${res.status}: ${err}`;
    }

    const data = await res.json();

    if (data.answer) {
      return `📌 AI 摘要: ${data.answer}\n\n---\n${data.results.map((r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.content}\n   🔗 ${r.url}`
      ).join('\n\n')}`;
    }

    return data.results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   ${r.content}\n   🔗 ${r.url}`
    ).join('\n\n');
  }
};
