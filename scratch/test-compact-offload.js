import assert from 'assert';
import { compactMessages } from '../src/lib/messageBuilder.js';

async function runTests() {
  console.log('🧪 Starting Double-Stage Compaction Tests...');

  // --- Test Case 1: Soft-Compact with Offloaded File Preview ---
  console.log('1. Testing Soft-Compact skipping on already offloaded tool outputs...');
  
  const mockMessages = [
    {
      role: 'user',
      content: 'Hello',
      turn: 1
    },
    {
      role: 'assistant',
      type: 'tool_call',
      toolName: 'ls',
      toolInput: {},
      id: 'call-1',
      toolOutput: '[OUTPUT OFFLOADED TO FILE: .offloaded/offload-123.txt (size: 25000 bytes).\n--- PREVIEW START (First 1500 chars) ---\nSome output...\n--- PREVIEW END ---]',
      turn: 1
    },
    {
      role: 'assistant',
      type: 'tool_call',
      toolName: 'grep',
      toolInput: {},
      id: 'call-2',
      toolOutput: 'a'.repeat(2500), // Should be compacted (length > 2000)
      turn: 1
    }
  ];

  // Call compactMessages
  // Params: messages, turnIndex, currentTokens, systemPrompt, tools, thinkingEnabled, compactionEnabled
  // To trigger soft compact, turnIndex must be > 5, and currentTokens must be > 120000
  const result = compactMessages(
    mockMessages,
    7, // turnIndex = 7 (> 5)
    130000, // currentTokens = 130000 (> 120000)
    'System prompt',
    [],
    false,
    true
  );

  const compactedMsgs = result.messages;
  
  // Find call-1
  const call1 = compactedMsgs.find(m => m.id === 'call-1');
  assert(call1, 'call-1 should exist');
  assert(call1.toolOutput.includes('OUTPUT OFFLOADED TO FILE:'), 'call-1 should retain offloaded path preview');
  assert(!call1.toolOutput.includes('[已折叠旧的工具输出结果]'), 'call-1 should NOT be secondary compacted');

  // Find call-2
  const call2 = compactedMsgs.find(m => m.id === 'call-2');
  assert(call2, 'call-2 should exist');
  assert(call2.toolOutput.includes('[已折叠旧的工具输出结果]'), 'call-2 should be secondary compacted because it was not offloaded to file');

  console.log('✅ Soft-compact test passed!');

  // --- Test Case 2: Strip <analysis> and Extract <summary> ---
  console.log('2. Testing Hard-Compact <analysis> stripping and <summary> extraction regex...');

  const summaryRaw1 = `<analysis>
The agent did some steps and completed task 1, 2, 3.
There is a chronological review.
</analysis>
<summary>
1. Primary Request: Optimize context compaction.
2. Technical Concepts: Regexp, system messages.
3. Next Steps: Continue task.
</summary>`;

  let summary1 = summaryRaw1;
  summary1 = summary1.replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, '').trim();
  const match1 = /<summary>([\s\S]*?)<\/summary>/i.exec(summary1);
  if (match1) {
    summary1 = match1[1].trim();
  } else {
    summary1 = summary1.replace(/<\/?summary>/gi, '').trim();
  }

  assert(!summary1.includes('<analysis>'), 'Should strip <analysis> block');
  assert(!summary1.includes('<summary>'), 'Should strip <summary> tag');
  assert(summary1.includes('1. Primary Request: Optimize context compaction.'), 'Should contain correct summary content');

  // Test case 2.2: Fallback when <summary> tags are missing but we strip them
  const summaryRaw2 = `<analysis>
Some thinking process here.
</analysis>
1. Primary Request: Optimize context compaction.
2. Technical Concepts: Regexp.`;

  let summary2 = summaryRaw2;
  summary2 = summary2.replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, '').trim();
  const match2 = /<summary>([\s\S]*?)<\/summary>/i.exec(summary2);
  if (match2) {
    summary2 = match2[1].trim();
  } else {
    summary2 = summary2.replace(/<\/?summary>/gi, '').trim();
  }

  assert(!summary2.includes('<analysis>'), 'Fallback: Should strip <analysis> block');
  assert(summary2.includes('1. Primary Request: Optimize context compaction.'), 'Fallback: Should retain remaining content');

  // Test case 2.3: Case insensitivity of tags
  const summaryRaw3 = `<ANALYSIS>
Some uppercase thinking.
</ANALYSIS>
<SUMMARY>
My summary content
</SUMMARY>`;

  let summary3 = summaryRaw3;
  summary3 = summary3.replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, '').trim();
  const match3 = /<summary>([\s\S]*?)<\/summary>/i.exec(summary3);
  if (match3) {
    summary3 = match3[1].trim();
  } else {
    summary3 = summary3.replace(/<\/?summary>/gi, '').trim();
  }

  assert(!summary3.includes('Some uppercase thinking'), 'Case insensitive tag stripping failed for analysis');
  assert(summary3 === 'My summary content', `Expected "My summary content", got "${summary3}"`);

  // Test case 2.4: Unclosed <analysis> tag due to truncation
  const summaryRaw4 = `<analysis>
Some thinking process that gets truncated...
[Tokens truncated here...`;

  let summary4 = summaryRaw4;
  summary4 = summary4.replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, '').trim();
  
  assert(summary4 === '', `Expected empty string for truncated analysis, got "${summary4}"`);

  console.log('✅ Hard-compact regex parsing tests passed!');

  console.log('🎉 All integrated tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
