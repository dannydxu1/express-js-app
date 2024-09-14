require('dotenv').config();
const express = require('express');
const expressWs = require('express-ws');
const websocketStream = require('websocket-stream/stream');
const { Transform } = require('stream');
const { createClient } = require('@deepgram/sdk');
const Twilio = require('twilio');
const path = require('path');

const app = express();
expressWs(app);

const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Set up Handlebars view engine
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Twilio webhook endpoint for incoming calls
app.post('/twiml', (req, res) => {
  console.log("/twiml accessed");
  console.log(req.body);
  res.set('Content-Type', 'application/xml');
  res.render('twiml', { host: req.hostname });
});

// WebSocket endpoint for Twilio Media Streams
app.ws('/media', (ws, req) => {
  console.log("/media accessed");
  const mediaStream = websocketStream(ws);
  let callSid;

  // Transform stream to extract audio from Twilio messages
  const audioStream = new Transform({
    objectMode: true,
    transform: (chunk, encoding, callback) => {
      const msg = JSON.parse(chunk.toString('utf8'));
      if (msg.event === 'start') {
        callSid = msg.start.callSid;
        console.log(`Call started: ${callSid}`);
      } else if (msg.event === 'media') {
        const payload = Buffer.from(msg.media.payload, 'base64');
        callback(null, payload);
      } else if (msg.event === 'stop') {
        console.log(`Call stopped: ${callSid}`);
        callback(null);
      } else {
        callback();
      }
    }
  });

  // Transform stream to ensure audio is in the correct format
  const pcmStream = new Transform({
    transform: (chunk, encoding, callback) => {
      // Assuming the audio is already in PCM 16-bit mono 8kHz
      callback(null, chunk);
    }
  });

  // Set up Deepgram's live transcription socket
  const deepgramSocket = deepgram.listen.live({
    punctuate: true,
    interim_results: false,
    language: 'en-US'
  });

  deepgramSocket.on(LiveTranscriptionEvents.Open, () => {
    console.log('Deepgram connection opened.');
  });

  deepgramSocket.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript) {
      console.log(`Transcription: ${transcript}`);
      // Here you can pass the transcription to the frontend or another service
    }
  });

  deepgramSocket.on(LiveTranscriptionEvents.Close, () => {
    console.log('Deepgram connection closed.');
  });


deepgramSocket.on(LiveTranscriptionEvents.Error, (error) => {
  console.error('Deepgram error:', error);
});

  // Pipe the audio stream through the transforms
  mediaStream.pipe(audioStream).pipe(pcmStream);

  // For each chunk of PCM data, send it to Deepgram
  pcmStream.on('data', (data) => {
    deepgramSocket.send(data);
  });

  ws.on('close', () => {
    console.log(`WebSocket closed for call: ${callSid}`);
    deepgramSocket.finish();
  });
});


console.log("f2");
  // Transform stream to ensure audio is in the correct format
  const pcmStream = new Transform({
    transform: (chunk, encoding, callback) => {
      // Assuming the audio is already in PCM 16-bit mono 8kHz
      // If not, you would need to convert it here
      callback(null, chunk);
    }
  });

console.log("f3");
  // Set up Deepgram's live transcription socket
  const deepgramSocket = deepgram.transcription.live({
    punctuate: true,
    interim_results: false,
    language: 'en-US'
  });
console.log("f3");
  deepgramSocket.addListener('open', () => {
    console.log('Deepgram connection opened.');
  });
console.log("f4");
  deepgramSocket.addListener('transcriptReceived', (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript) {
      console.log(`Transcription: ${transcript}`);
      // Here you can pass the transcription to the frontend or another service
    }
  });
console.log("f5");
  deepgramSocket.addListener('close', () => {
    console.log('Deepgram connection closed.');
  });

  // Pipe the audio stream through the transforms to Deepgram
  mediaStream.pipe(audioStream).pipe(pcmStream).pipe(deepgramSocket);
console.log("f6");
  ws.on('close', () => {
    console.log(`WebSocket closed for call: ${callSid}`);
    deepgramSocket.finish();
  });
});

app.get('/', (req, res) => {
  console.log("/endpoint accessed");
  res.send('Hello from your server at 137.184.142.230!');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
