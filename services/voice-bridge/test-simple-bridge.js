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
    <Stream url="wss://${req.hostname}/twilio-stream" />
  </Start>
  <Say>Connecting you now, please wait a moment.</Say>
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
  console.log('Twilio WebSocket connected');
  
  let openaiWS = null;
  let streamSid = null;
  let sessionReady = false;
  let audioBuffer = [];
  
  try {
    // Connect to OpenAI
    const wsUrl = `wss://api.openai.com/v1/realtime?model=${process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-10-01'}`;
    console.log('Connecting to OpenAI Realtime API...');
    console.log('URL:', wsUrl);
    
    openaiWS = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });
    
    openaiWS.on('open', () => {
      console.log('✅ WebSocket connection to OpenAI established');
      console.log('Sending session configuration...');
      
      // Configure session
      const sessionConfig = {
        type: 'session.update',
        session: {
          voice: 'alloy',
          instructions: 'You are a helpful healthcare assistant. Start by greeting the caller and asking how they are feeling today. Keep responses brief and conversational.',
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
          }
        }
      };
      
      openaiWS.send(JSON.stringify(sessionConfig));
      console.log('Session configuration sent, waiting for confirmation...');
    });
    
    openaiWS.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log(`[OpenAI] Message type: ${msg.type}`);
      
      switch(msg.type) {
        case 'session.created':
          console.log('✅ Session created successfully');
          console.log('Session ID:', msg.session.id);
          break;
          
        case 'session.updated':
          console.log('✅ Session configuration confirmed!');
          console.log('Voice:', msg.session.voice);
          console.log('Input format:', msg.session.input_audio_format);
          console.log('Output format:', msg.session.output_audio_format);
          sessionReady = true;
          
          // Send buffered audio if any
          if (audioBuffer.length > 0) {
            console.log(`Sending ${audioBuffer.length} buffered audio frames...`);
            audioBuffer.forEach(audio => {
              openaiWS.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: audio
              }));
            });
            audioBuffer = [];
          }
          
          // Create an initial response to greet the caller
          console.log('Triggering initial greeting...');
          openaiWS.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              instructions: 'Greet the caller warmly and ask how they are feeling today.'
            }
          }));
          break;
          
        case 'input_audio_buffer.speech_started':
          console.log('🎤 User started speaking');
          break;
          
        case 'input_audio_buffer.speech_stopped':
          console.log('🎤 User stopped speaking');
          break;
          
        case 'input_audio_buffer.committed':
          console.log('✅ Audio buffer committed');
          break;
          
        case 'response.created':
          console.log('📝 Response created');
          break;
          
        case 'response.done':
          console.log('✅ Response completed');
          if (msg.response && msg.response.usage) {
            console.log('Usage:', msg.response.usage);
          }
          break;
          
        case 'response.audio.delta':
          if (msg.delta) {
            // Send audio back to Twilio (no streamSid needed for outbound)
            const mediaMessage = {
              event: 'media',
              media: {
                payload: msg.delta
              }
            };
            twilioWS.send(JSON.stringify(mediaMessage));
            // Log every 10th audio packet to avoid spam
            if (Math.random() < 0.1) {
              console.log('📤 Sending audio chunk to Twilio');
            }
          }
          break;
          
        case 'response.audio_transcript.delta':
          if (msg.delta) {
            process.stdout.write(msg.delta);
          }
          break;
          
        case 'response.audio_transcript.done':
          console.log('\n[AI Response]:', msg.transcript);
          break;
          
        case 'conversation.item.created':
          if (msg.item) {
            console.log(`[Conversation] New item (${msg.item.role}):`, 
              msg.item.content?.[0]?.transcript || msg.item.content?.[0]?.text || '(audio)');
          }
          break;
          
        case 'conversation.item.input_audio_transcription.completed':
          console.log('[User said]:', msg.transcript);
          break;
          
        case 'error':
          console.error('❌ OpenAI Error:', msg.error);
          break;
          
        default:
          if (msg.type.includes('error')) {
            console.error('Error event:', msg);
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
  
  twilioWS.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log('📞 Twilio stream started');
        console.log('Stream SID:', streamSid);
        console.log('Call SID:', msg.start.callSid);
        console.log('Account SID:', msg.start.accountSid);
        console.log('Tracks:', msg.start.tracks);
      } else if (msg.event === 'media') {
        // Check if we should forward audio
        if (!openaiWS) {
          console.error('No OpenAI connection');
          return;
        }
        
        if (openaiWS.readyState !== WebSocket.OPEN) {
          console.error('OpenAI WebSocket not open');
          return;
        }
        
        if (!sessionReady) {
          // Buffer audio until session is ready
          audioBuffer.push(msg.media.payload);
          if (audioBuffer.length % 50 === 0) {
            console.log(`Buffering audio... (${audioBuffer.length} frames)`);
          }
        } else {
          // Forward audio to OpenAI
          openaiWS.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: msg.media.payload
          }));
        }
      } else if (msg.event === 'stop') {
        console.log('📞 Twilio stream stopped');
        if (openaiWS) {
          console.log('Closing OpenAI connection...');
          openaiWS.close();
        }
      } else if (msg.event === 'mark') {
        console.log('Mark event:', msg.mark);
      }
    } catch (error) {
      console.error('Error processing Twilio message:', error);
    }
  });
  
  twilioWS.on('close', () => {
    console.log('Twilio WebSocket closed');
    if (openaiWS && openaiWS.readyState === WebSocket.OPEN) {
      openaiWS.close();
    }
  });
  
  twilioWS.on('error', (error) => {
    console.error('Twilio WebSocket error:', error);
  });
}

const PORT = 8081;
server.listen(PORT, () => {
  console.log(`Simple bridge server running on port ${PORT}`);
});