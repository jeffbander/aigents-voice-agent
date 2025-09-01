const twilio = require('twilio');
require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

const client = twilio(accountSid, authToken);

async function makeTestCall() {
  try {
    console.log('Initiating test call with simple bridge...');
    console.log('From:', fromNumber);
    console.log('To: +16465565559');
    
    const call = await client.calls.create({
      to: '+16465565559',
      from: fromNumber,
      url: 'https://da4d6bc2f640.ngrok-free.app/twiml',
      statusCallback: 'https://da4d6bc2f640.ngrok-free.app/status',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
    });
    
    console.log('Call initiated successfully!');
    console.log('Call SID:', call.sid);
    console.log('Status:', call.status);
    console.log('\nAnswer the call to test the OpenAI Realtime integration!');
    
    return call;
  } catch (error) {
    console.error('Error making call:', error.message);
    throw error;
  }
}

makeTestCall()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));