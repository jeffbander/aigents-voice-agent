const express = require('express');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// TwiML endpoint
app.post('/twiml', (req, res) => {
  console.log('TwiML request received');
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://${req.hostname}/twilio-stream" />
  </Start>
  <Say>Testing audio playback. You should hear beeps after this message.</Say>
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

// Generate a simple beep sound in μ-law format
function generateBeep(durationMs = 200, frequencyHz = 440) {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * durationMs / 1000);
  const buffer = Buffer.alloc(samples);
  
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequencyHz * t);
    // Convert to μ-law (simplified - just for testing)
    const pcm = Math.floor(sample * 32767);
    buffer[i] = linearToMulaw(pcm);
  }
  
  return buffer.toString('base64');
}

// Simplified linear to μ-law conversion
function linearToMulaw(sample) {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;
  const sign = (sample >> 8) & 0x80;
  
  if (sign !== 0) sample = -sample;
  if (sample > MULAW_MAX) sample = MULAW_MAX;
  
  sample = sample + MULAW_BIAS;
  const exponent = Math.floor(Math.log2(sample)) - 5;
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const mulaw = ~(sign | (exponent << 4) | mantissa);
  
  return mulaw & 0xFF;
}

function handleTwilioStream(twilioWS) {
  console.log('🔌 Twilio WebSocket connected');
  
  let streamSid = null;
  let beepCount = 0;
  
  twilioWS.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log('📞 Stream started:', streamSid);
        console.log('  Tracks:', msg.start.tracks);
        
        // Send beeps every 2 seconds
        const beepInterval = setInterval(() => {
          if (beepCount >= 5) {
            clearInterval(beepInterval);
            return;
          }
          
          beepCount++;
          console.log(`🔔 Sending beep #${beepCount}`);
          
          // Generate and send a beep
          const beepAudio = generateBeep(200, 440 + (beepCount * 100));
          
          const mediaMessage = {
            event: 'media',
            media: {
              payload: beepAudio
            }
          };
          
          console.log(`  Payload length: ${beepAudio.length} bytes`);
          console.log(`  First 50 chars: ${beepAudio.substring(0, 50)}`);
          
          twilioWS.send(JSON.stringify(mediaMessage));
          
          // Also try with streamSid
          const mediaMessage2 = {
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: beepAudio
            }
          };
          
          setTimeout(() => {
            console.log(`  Trying with streamSid...`);
            twilioWS.send(JSON.stringify(mediaMessage2));
          }, 500);
          
        }, 2000);
        
      } else if (msg.event === 'media') {
        // Just count incoming frames
      } else if (msg.event === 'stop') {
        console.log('📞 Stream stopped');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  });
  
  twilioWS.on('close', () => {
    console.log('🔌 WebSocket closed');
  });
}

const PORT = 8081;
server.listen(PORT, () => {
  console.log(`🔊 Beep test server running on port ${PORT}`);
  console.log('This will send test beeps to verify audio playback works');
});