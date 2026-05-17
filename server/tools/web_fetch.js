export default {
  name: 'web_fetch',
  description: 'Fetch the full main content of a specified web page (cleaned and converted to Markdown). Use this after finding a URL via web_search to read the full article.',
  parameters: {
    url: {
      type: 'string',
      description: 'The full URL of the web page to fetch (e.g., https://example.com/article)',
      required: true
    }
  },
  execute: async ({ url }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return '[ERROR] TAVILY_API_KEY is not configured. Please set it in .env.';

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
      return `[FETCH FAILED] HTTP ${res.status}: ${err}`;
    }

    const data = await res.json();
    const result = data.results?.[0];

    if (!result || !result.raw_content) {
      return `[FETCH FAILED] Could not extract main content from "${url}". The site might be blocking crawlers or requires authentication.`;
    }

    return `📄 **${result.title || url}**\n\n${result.raw_content}`;
  }
};
