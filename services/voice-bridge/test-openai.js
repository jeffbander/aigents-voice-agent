const WebSocket = require('ws');
require('dotenv').config();

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-10-01';

console.log('Testing OpenAI Realtime connection...');
console.log('Model:', model);

const wsUrl = `wss://api.openai.com/v1/realtime?model=${model}`;
const ws = new WebSocket(wsUrl, {
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'OpenAI-Beta': 'realtime=v1'
  }
});

ws.on('open', () => {
  console.log('✅ Connected to OpenAI Realtime API!');
  
  // Send a session update
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      voice: 'alloy',
      instructions: 'You are a helpful assistant.',
      input_audio_format: 'g711_ulaw',
      output_audio_format: 'g711_ulaw'
    }
  }));
  
  console.log('Session configuration sent');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', msg.type);
  if (msg.type === 'session.updated') {
    console.log('✅ Session configured successfully!');
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  if (error.message.includes('401')) {
    console.error('Authentication failed - check your API key');
  } else if (error.message.includes('403')) {
    console.error('Access denied - check if you have access to the Realtime API');
  }
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log('Connection closed:', code, reason.toString());
});

setTimeout(() => {
  console.log('Test timed out');
  ws.close();
  process.exit(1);
}, 10000);