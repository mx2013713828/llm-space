export default {
  name: 'web_fetch',
  description: '获取指定网页的完整正文内容（已清洗为 Markdown）。适用场景：在 web_search 找到网页后，抓取全文深入阅读。',
  parameters: {
    url: {
      type: 'string',
      description: '要抓取的网页完整 URL（如 https://example.com/article）',
      required: true
    }
  },
  execute: async ({ url }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return '[错误] 未配置 TAVILY_API_KEY，请在 .env 中设置。';

    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ urls: [url] })
    });

    if (!res.ok) {
      const err = await res.text();
      return `[抓取失败] HTTP ${res.status}: ${err}`;
    }

    const data = await res.json();
    const result = data.results?.[0];

    if (!result || !result.raw_content) {
      return `[抓取失败] 未能提取到 "${url}" 的正文内容，该网站可能被屏蔽或需要身份验证。`;
    }

    return `📄 **${result.title || url}**\n\n${result.raw_content}`;
  }
};
