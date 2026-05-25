import { spawn } from 'child_process';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';

const TEST_PORT = '3999';
const MOCK_LLM_PORT = 4000;
const TEST_HARNESS_ID = 'test-harness-spec-run';

let serverProcess = null;
let mockLLMServer = null;

// Helper: Wait for milliseconds
const delay = ms => new Promise(r => setTimeout(r, ms));

// Step 1: Start Mock LLM Server
function startMockLLM() {
  mockLLMServer = http.createServer((req, res) => {
    // Check if it's the messages endpoint
    if (req.url === '/v1/messages' && req.method === 'POST') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Stream Mock SSE chunks
      const dataLine = (type, deltaText = '', stopReason = null) => {
        const payload = {
          type,
          message: { model: 'claude-mock', usage: { input_tokens: 100 } }
        };
        if (type === 'content_block_start') {
          payload.content_block = { type: 'text' };
          payload.index = 0;
        } else if (type === 'content_block_delta') {
          payload.delta = { type: 'text_delta', text: deltaText };
        } else if (type === 'message_delta') {
          payload.delta = { stop_reason: stopReason || 'end_turn' };
          payload.usage = { output_tokens: 50 };
        }
        return `data: ${JSON.stringify(payload)}\n\n`;
      };

      res.write(dataLine('message_start'));
      res.write(dataLine('content_block_start'));
      
      // Simulate delay for thinking/streaming
      setTimeout(() => {
        res.write(dataLine('content_block_delta', 'Thought process completed. '));
      }, 500);

      setTimeout(() => {
        res.write(dataLine('content_block_delta', 'Implementing session persistence test.'));
      }, 1000);

      setTimeout(() => {
        res.write(dataLine('content_block_delta', ' All checks completed successfully.'));
        res.write(dataLine('message_delta', '', 'end_turn'));
        res.write('data: [DONE]\n\n');
        res.end();
      }, 2500); // 2.5 seconds total stream
    } else {
      res.writeHead(404).end();
    }
  });

  mockLLMServer.listen(MOCK_LLM_PORT, () => {
    console.log(`🤖 Mock LLM server running on http://localhost:${MOCK_LLM_PORT}`);
  });
}

// Step 2: Start server.js Subprocess
function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['server.js'], {
      env: {
        ...process.env,
        PORT: TEST_PORT,
      }
    });

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      // Print all server logs prefixed with [Server]
      console.log(`[Server] ${msg}`);
      if (msg.includes('LLM Space 代理服务器运行在')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server Stderr] ${data}`);
    });

    serverProcess.on('error', reject);
  });
}

async function runTests() {
  console.log('🧪 Starting Active-Job E2E Integration and Persistence Tests...\n');

  startMockLLM();
  await startServer();

  // Define target session storage path to clean up later
  const sessionPath = path.join(process.cwd(), 'server', 'sessions', `${TEST_HARNESS_ID}.json`);
  await fs.unlink(sessionPath).catch(() => {}); // Clean existing

  try {
    // --- TEST CASE 1: Start Active Job & Simulate Client Disconnect ---
    console.log('\n--- Test Case 1: Start Active Job and Disconnect client ---');
    
    const requestPayload = {
      harnessId: TEST_HARNESS_ID,
      messages: [{ role: 'user', content: 'Run end-to-end persistent test' }],
      todos: [],
      systemPrompt: 'You are a test assistant.',
      tools: [],
      features: { context_compaction: true },
      model: {
        name: 'claude-mock',
        modelId: 'claude-mock',
        key: 'mock-key',
        url: `http://localhost:${MOCK_LLM_PORT}`
      },
      temperature: 1,
      maxTokens: 1000,
      thinkingEnabled: false,
    };

    const controller1 = new AbortController();
    const res1 = await fetch(`http://localhost:${TEST_PORT}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: controller1.signal,
    });

    // Create a reader to consume res1 body in background so socket won't hang
    const reader1 = res1.body.getReader();
    const readPromise = (async () => {
      try {
        while (true) {
          const { done } = await reader1.read();
          if (done) break;
        }
      } catch (e) {}
    })();

    // Wait for SSE connection to establish and receive initial event
    await delay(300);

    // Abort the client connection 1 (simulate F5 refresh / tab close)
    console.log(' - Aborting client 1 connection (simulating browser reload)...');
    controller1.abort();
    
    // Await the consumer loop termination
    await readPromise;
    console.log(' ✅ Client 1 disconnected.');

    // --- TEST CASE 2: Verify Job remains running in background ---
    console.log('\n--- Test Case 2: Query active running status ---');
    await delay(200);

    const statusRes = await fetch(`http://localhost:${TEST_PORT}/api/agent/status/${TEST_HARNESS_ID}`);
    const statusData = await statusRes.json();
    console.log(' - Query status result:', statusData);
    if (statusData.isRunning !== true) {
      throw new Error('Test Fail: Active job did not persist in background after client 1 disconnected!');
    }
    console.log(' ✅ Job is still running silently in background.');

    // --- TEST CASE 3: Attach Client 2 and synchronize memory on fly ---
    console.log('\n--- Test Case 3: Connect Client 2 (Attach) and Hydrate ---');

    const res2 = await fetch(`http://localhost:${TEST_PORT}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harnessId: TEST_HARNESS_ID, model: { key: 'mock-key' } }), // Only minimal keys needed
    });

    const reader = res2.body.getReader();
    const decoder = new TextDecoder();
    let attachedEvents = [];
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const raw = line.slice(6).trim();
            if (raw !== '[DONE]') {
              attachedEvents.push(JSON.parse(raw));
            }
          } catch (e) {}
        }
      }
    }

    console.log(` - Received ${attachedEvents.length} events on Client 2 connection.`);
    
    // The very first event sent to attached client must be messages_update
    const firstEvent = attachedEvents[0];
    if (!firstEvent || firstEvent.type !== 'messages_update') {
      throw new Error('Test Fail: Connected client did not receive initial status rehydration (messages_update)!');
    }
    console.log(' ✅ First event is indeed messages_update (status synchronized).');

    // Confirm that final message text from LLM is correctly streamed to Client 2
    const textDeltaEvents = attachedEvents.filter(e => e.type === 'text_delta');
    console.log(` - Text delta count: ${textDeltaEvents.length}`);
    const textContent = textDeltaEvents.map(e => e.text).join('');
    console.log(` - Reconstructed text output: "${textContent}"`);
    if (!textContent.includes('session persistence test')) {
      throw new Error('Test Fail: Stream payload was not broadcasted to attached Client 2!');
    }
    console.log(' ✅ Sub-messages successfully streamed to attached Client 2.');

    // --- TEST CASE 4: Verify Session JSON file is persisted on disk ---
    console.log('\n--- Test Case 4: Verify session state persisted to sessions/ ---');
    await delay(300);

    const exists = await fs.access(sessionPath).then(() => true).catch(() => false);
    if (!exists) {
      throw new Error('Test Fail: Session JSON file was not created on server/sessions/ directory!');
    }
    console.log(' ✅ Session json file created on disk.');

    const sessionContent = await fs.readFile(sessionPath, 'utf-8');
    const sessionObj = JSON.parse(sessionContent);
    console.log(` - Session messages length: ${sessionObj.messages?.length}`);
    
    const userMsg = sessionObj.messages.find(m => m.role === 'user');
    const assistantTextMsg = sessionObj.messages.find(m => m.role === 'assistant' && m.type === 'text');

    if (!userMsg || !assistantTextMsg || !assistantTextMsg.content.includes('checks completed')) {
      throw new Error('Test Fail: Saved session file messages are empty or missing final results!');
    }
    console.log(' ✅ Persistent session messages match exact run results.');

  } finally {
    // Cleanup temporary files and kill child processes
    console.log('\n🧹 Cleaning up test assets and stopping servers...');
    await fs.unlink(sessionPath).catch(() => {});
    
    if (serverProcess) {
      serverProcess.kill();
    }
    if (mockLLMServer) {
      mockLLMServer.close();
    }
  }

  console.log('\n🎉 All Active-Job and Persistence Integration Tests passed successfully!');
}

runTests().catch(err => {
  console.error('\n❌ Test execution failed:', err);
  if (serverProcess) serverProcess.kill();
  if (mockLLMServer) mockLLMServer.close();
  process.exit(1);
});
