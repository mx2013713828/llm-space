export default {
  name: 'web_search',
  description: 'Search the internet for up-to-date information. Returns structured results including titles, URLs, and content snippets. Use this for real-time information, news, or data queries.',
  parameters: {
    query: {
      type: 'string',
      description: 'Search keyword or question (concise natural language is recommended)',
      required: true
    }
  },
  execute: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return '[ERROR] TAVILY_API_KEY is not configured. Please set it in .env.';

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
      return `[SEARCH FAILED] HTTP ${res.status}: ${err}`;
    }

    const data = await res.json();

    if (data.answer) {
      return `📌 AI Summary: ${data.answer}\n\n---\n${data.results.map((r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.content}\n   🔗 ${r.url}`
      ).join('\n\n')}`;
    }

    return data.results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   ${r.content}\n   🔗 ${r.url}`
    ).join('\n\n');
  }
};
