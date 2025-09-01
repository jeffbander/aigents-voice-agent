const twilio = require('twilio');
require('dotenv').config();

// Twilio credentials from environment
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

const client = twilio(accountSid, authToken);

async function makeTestCall() {
  try {
    console.log('Initiating test call...');
    console.log('From:', fromNumber);
    console.log('To: +16465565559');
    
    const call = await client.calls.create({
      to: '+16465565559',
      from: fromNumber,
      url: 'https://demo.twilio.com/welcome/voice/',  // Using Twilio demo for testing
      statusCallback: 'https://webhook.site/unique-id', // Optional status callback
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
    });
    
    console.log('Call initiated successfully!');
    console.log('Call SID:', call.sid);
    console.log('Call status:', call.status);
    
    return call;
  } catch (error) {
    console.error('Error making call:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
      console.error('More info:', error.moreInfo);
    }
    throw error;
  }
}

// Make the test call
makeTestCall()
  .then(() => {
    console.log('Test call completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test call failed');
    process.exit(1);
  });