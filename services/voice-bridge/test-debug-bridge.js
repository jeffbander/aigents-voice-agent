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

// TwiML endpoint
app.post('/twiml', (req, res) => {
  console.log('TwiML request received');
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://${req.hostname}/twilio-stream" track="both_tracks" />
  </Start>
  <Say>Connecting you to the assistant, please wait.</Say>
  <Pause length="60" />
</Response>`;
  res.type('text/xml').send(twiml);
});

// WebSocket server
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/twilio-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleTwilioStream(ws);
    });
  } else {
    socket.destroy();
  }
});

function handleTwilioStream(twilioWS) {
  console.log('🔌 Twilio WebSocket connected');
  
  let openaiWS = null;
  let streamSid = null;
  let sessionReady = false;
  let audioBuffer = [];
  let audioPacketCount = 0;
  let twilioPacketCount = 0;
  
  try {
    // Connect to OpenAI
    const wsUrl = `wss://api.openai.com/v1/realtime?model=${process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-10-01'}`;
    console.log('🔗 Connecting to OpenAI Realtime API...');
    
    openaiWS = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });
    
    openaiWS.on('open', () => {
      console.log('✅ OpenAI WebSocket connected');
      
      // Configure session with explicit audio formats
      const sessionConfig = {
        type: 'session.update',
        session: {
          voice: 'alloy',
          instructions: 'You are a helpful healthcare assistant. Start by greeting the caller warmly and asking how they are feeling today. Keep responses very brief.',
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
      
      console.log('📤 Sending session config:', JSON.stringify(sessionConfig.session, null, 2));
      openaiWS.send(JSON.stringify(sessionConfig));
    });
    
    openaiWS.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      switch(msg.type) {
        case 'session.created':
          console.log('✅ Session created:', msg.session.id);
          break;
          
        case 'session.updated':
          console.log('✅ Session updated successfully!');
          console.log('  Voice:', msg.session.voice);
          console.log('  Input format:', msg.session.input_audio_format);
          console.log('  Output format:', msg.session.output_audio_format);
          sessionReady = true;
          
          // Process buffered audio
          if (audioBuffer.length > 0) {
            console.log(`📦 Processing ${audioBuffer.length} buffered audio frames`);
            audioBuffer.forEach(audio => {
              openaiWS.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: audio
              }));
            });
            audioBuffer = [];
          }
          
          // Send initial greeting
          console.log('🎤 Triggering AI greeting...');
          openaiWS.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio']
            }
          }));
          break;
          
        case 'response.audio.delta':
          if (msg.delta) {
            audioPacketCount++;
            
            // Debug the audio packet
            const audioData = msg.delta;
            const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(audioData);
            const dataLength = audioData.length;
            
            if (audioPacketCount === 1) {
              console.log('🎵 First audio packet details:');
              console.log('  Is Base64:', isBase64);
              console.log('  Length:', dataLength);
              console.log('  First 50 chars:', audioData.substring(0, 50));
            }
            
            // Try sending with streamSid (some docs suggest this)
            const mediaMessage = {
              event: 'media',
              streamSid: streamSid,
              media: {
                payload: audioData
              }
            };
            
            // Log every 10th packet with full message structure
            if (audioPacketCount % 10 === 1) {
              console.log(`📤 Sending audio packet #${audioPacketCount} to Twilio (${dataLength} bytes)`);
              if (audioPacketCount === 1) {
                console.log('  Full message structure:', JSON.stringify(mediaMessage).substring(0, 200));
              }
            }
            
            twilioWS.send(JSON.stringify(mediaMessage));
          }
          break;
          
        case 'response.audio_transcript.done':
          console.log('🤖 AI said:', msg.transcript);
          break;
          
        case 'conversation.item.input_audio_transcription.completed':
          console.log('👤 User said:', msg.transcript);
          break;
          
        case 'input_audio_buffer.speech_started':
          console.log('🎤 User started speaking');
          break;
          
        case 'input_audio_buffer.speech_stopped':
          console.log('🎤 User stopped speaking');
          break;
          
        case 'response.done':
          console.log(`✅ Response complete. Audio packets sent: ${audioPacketCount}`);
          audioPacketCount = 0;
          break;
          
        case 'error':
          console.error('❌ OpenAI Error:', msg.error);
          break;
          
        default:
          // Only log important events
          if (!msg.type.includes('.delta') && !msg.type.includes('rate_limits')) {
            console.log(`[OpenAI] ${msg.type}`);
          }
      }
    });
    
    openaiWS.on('error', (error) => {
      console.error('❌ OpenAI WebSocket error:', error.message);
    });
    
    openaiWS.on('close', (code, reason) => {
      console.log('OpenAI WebSocket closed:', code, reason.toString());
      sessionReady = false;
    });
    
  } catch (error) {
    console.error('Failed to connect to OpenAI:', error);
  }
  
  // Handle Twilio messages
  twilioWS.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log('📞 Twilio stream started');
        console.log('  Stream SID:', streamSid);
        console.log('  Call SID:', msg.start.callSid);
        console.log('  Media format:', msg.start.mediaFormat);
        console.log('  Tracks:', msg.start.tracks);
      } else if (msg.event === 'media') {
        twilioPacketCount++;
        
        // Check if OpenAI is ready
        if (!openaiWS || openaiWS.readyState !== WebSocket.OPEN) {
          if (twilioPacketCount % 50 === 1) {
            console.log(`⚠️ OpenAI not ready, buffering audio (${audioBuffer.length} frames)`);
          }
          if (!sessionReady) {
            audioBuffer.push(msg.media.payload);
          }
          return;
        }
        
        if (!sessionReady) {
          audioBuffer.push(msg.media.payload);
          if (audioBuffer.length % 50 === 0) {
            console.log(`📦 Buffering: ${audioBuffer.length} frames`);
          }
        } else {
          // Forward to OpenAI
          openaiWS.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: msg.media.payload
          }));
          
          // Log every 100th packet
          if (twilioPacketCount % 100 === 0) {
            console.log(`🎧 Received ${twilioPacketCount} audio frames from Twilio`);
          }
        }
      } else if (msg.event === 'stop') {
        console.log('📞 Twilio stream stopped');
        if (openaiWS) {
          openaiWS.close();
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
  console.log(`🚀 Debug bridge server running on port ${PORT}`);
  console.log('📋 Audio flow: Twilio -> μ-law 8kHz -> OpenAI -> μ-law 8kHz -> Twilio');
});