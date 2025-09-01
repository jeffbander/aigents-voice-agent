const express = require('express');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/healthz', (req, res) => {
  res.json({ status: 'healthy' });
});

// TwiML endpoint - Using Connect with bidirectional Stream
app.post('/twiml', (req, res) => {
  console.log('📞 TwiML request received');
  console.log('  Call SID:', req.body.CallSid);
  console.log('  From:', req.body.From);
  
  // Use Connect with Stream - trying to force bidirectional
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${req.hostname}/media-stream" track="both_tracks">
      <Parameter name="callSid" value="${req.body.CallSid}" />
      <Parameter name="bidirectional" value="true" />
    </Stream>
  </Connect>
</Response>`;
  
  console.log('📋 Sending TwiML with Connect/Stream for bidirectional audio');
  res.type('text/xml').send(twiml);
});

// WebSocket server for bidirectional media streams
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  console.log('🔄 WebSocket upgrade request:', request.url);
  
  if (request.url === '/media-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleMediaStream(ws);
    });
  } else {
    socket.destroy();
  }
});

function handleMediaStream(twilioWS) {
  console.log('✅ Twilio bidirectional WebSocket connected');
  
  let openaiWS = null;
  let streamSid = null;
  let callSid = null;
  let sessionReady = false;
  let audioBuffer = [];
  let messageCount = 0;
  
  try {
    // Connect to OpenAI Realtime
    const wsUrl = `wss://api.openai.com/v1/realtime?model=${process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-10-01'}`;
    console.log('🔗 Connecting to OpenAI Realtime...');
    
    openaiWS = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });
    
    openaiWS.on('open', () => {
      console.log('✅ OpenAI connected, configuring session...');
      
      const sessionConfig = {
        type: 'session.update',
        session: {
          voice: 'alloy',
          instructions: 'You are a helpful healthcare assistant. Greet the caller warmly and ask how they are feeling today. Keep responses conversational and brief.',
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          input_audio_transcription: {
            model: 'whisper-1'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 200
          },
          modalities: ['text', 'audio'],
          temperature: 0.8
        }
      };
      
      openaiWS.send(JSON.stringify(sessionConfig));
    });
    
    openaiWS.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      switch(msg.type) {
        case 'session.created':
          console.log('📝 Session created:', msg.session.id);
          break;
          
        case 'session.updated':
          console.log('✅ Session ready!');
          sessionReady = true;
          
          // Send buffered audio if any
          if (audioBuffer.length > 0) {
            console.log(`📦 Sending ${audioBuffer.length} buffered audio frames`);
            audioBuffer.forEach(audio => {
              openaiWS.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: audio
              }));
            });
            audioBuffer = [];
          }
          
          // Trigger initial greeting
          console.log('🎤 Requesting AI greeting...');
          openaiWS.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio']
            }
          }));
          break;
          
        case 'response.audio.delta':
          if (msg.delta) {
            console.log(`🔊 Got audio delta from OpenAI (${msg.delta.length} bytes)`);
            
            if (!streamSid) {
              console.error('❌ No streamSid available!');
              return;
            }
            
            // Send audio back to Twilio
            const mediaMessage = {
              event: 'media',
              streamSid: streamSid,
              media: {
                payload: msg.delta,
                track: 'outbound'  // Specify outbound track for Connect
              }
            };
            
            console.log('📤 Sending audio to Twilio track:outbound');
            twilioWS.send(JSON.stringify(mediaMessage));
          }
          break;
          
        case 'response.audio_transcript.done':
          console.log('🤖 AI:', msg.transcript);
          break;
          
        case 'conversation.item.input_audio_transcription.completed':
          console.log('👤 User:', msg.transcript);
          break;
          
        case 'error':
          console.error('❌ OpenAI error:', msg.error);
          break;
      }
    });
    
    openaiWS.on('error', (error) => {
      console.error('❌ OpenAI WebSocket error:', error.message);
    });
    
    openaiWS.on('close', () => {
      console.log('OpenAI WebSocket closed');
      sessionReady = false;
    });
    
  } catch (error) {
    console.error('Failed to connect to OpenAI:', error);
  }
  
  // Handle Twilio messages
  twilioWS.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      messageCount++;
      
      // Log first few messages to understand structure
      if (messageCount <= 3) {
        console.log(`📨 Twilio message #${messageCount}:`, JSON.stringify(msg).substring(0, 200));
      }
      
      switch(msg.event) {
        case 'connected':
          console.log('🎯 Twilio says: Connected!');
          console.log('  Protocol:', msg.protocol);
          console.log('  Version:', msg.version);
          break;
          
        case 'start':
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid || msg.start.customParameters?.callSid;
          console.log('🎬 Stream started');
          console.log('  Stream SID:', streamSid);
          console.log('  Call SID:', callSid);
          console.log('  Tracks:', msg.start.tracks);
          console.log('  Media format:', msg.start.mediaFormat);
          
          // Important: Check if we have both inbound and outbound tracks
          if (!msg.start.tracks || msg.start.tracks.length === 1) {
            console.warn('⚠️ WARNING: Only one track detected. Bidirectional audio may not work!');
            console.warn('  Tracks:', msg.start.tracks);
          } else {
            console.log('✅ Bidirectional tracks confirmed:', msg.start.tracks);
          }
          break;
          
        case 'media':
          // Forward audio to OpenAI if ready
          if (openaiWS && openaiWS.readyState === WebSocket.OPEN) {
            if (!sessionReady) {
              audioBuffer.push(msg.media.payload);
            } else {
              openaiWS.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: msg.media.payload
              }));
            }
          }
          break;
          
        case 'stop':
          console.log('🛑 Stream stopped');
          if (openaiWS) openaiWS.close();
          break;
          
        default:
          if (messageCount <= 10) {
            console.log(`📨 Event: ${msg.event}`);
          }
      }
    } catch (error) {
      console.error('Error processing Twilio message:', error);
    }
  });
  
  twilioWS.on('close', () => {
    console.log('🔌 Twilio WebSocket closed');
    if (openaiWS && openaiWS.readyState === WebSocket.OPEN) {
      openaiWS.close();
    }
  });
  
  twilioWS.on('error', (error) => {
    console.error('❌ Twilio WebSocket error:', error);
  });
}

const PORT = 8081;
server.listen(PORT, () => {
  console.log(`🎙️ Bidirectional bridge server running on port ${PORT}`);
  console.log('📡 Using Twilio Connect with Stream for bidirectional audio');
  console.log('🔊 Audio flow: Twilio ↔️ OpenAI Realtime (μ-law 8kHz)');
});