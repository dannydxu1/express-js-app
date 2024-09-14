// server.js

require('dotenv').config();
const express = require('express');
const expressWs = require('express-ws');
const websocketStream = require('websocket-stream/stream');
const { Transform } = require('stream');
const WaveFile = require('wavefile').WaveFile;
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
  res.set('Content-Type', 'application/xml');
  res.render('twiml', { host: req.hostname });
});

// WebSocket endpoint for Twilio Media Streams
app.ws('/media', (ws, req) => {
  const mediaStream = websocketStream(ws);
  let callSid;

  const audioStream = new Transform({
    transform(chunk, encoding, callback) {
      const message = JSON.parse(chunk.toString('utf8'));

      if (message.event === 'start') {
        callSid = message.start.callSid;
        console.log(`Call started: ${callSid}`);
      }

      if (message.event === 'media') {
        const payload = Buffer.from(message.media.payload, 'base64');
        this.push(payload);
      }

      callback();
    },
  });

  const pcmStream = new Transform({
    transform(chunk, encoding, callback) {
      // Convert μ-law to PCM
      const wav = new WaveFile();
      wav.fromScratch(1, 8000, '8m', chunk);
      wav.fromMuLaw();
      const pcmData = Buffer.from(wav.data.samples);
      this.push(pcmData);
      callback();
    },
  });

  // Deepgram live transcription
  const deepgramSocket = deepgram.transcription.live({
    punctuate: true,
    interim_results: false,
  });

  deepgramSocket.addListener('open', () => {
    console.log('Deepgram connection opened.');
  });

  deepgramSocket.addListener('transcriptReceived', (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript) {
      console.log(`Transcription: ${transcript}`);
      // Here you can pass the transcription to the frontend or another service
    }
  });

  deepgramSocket.addListener('close', () => {
    console.log('Deepgram connection closed.');
  });

  // Pipe the audio stream through the transforms to Deepgram
  mediaStream.pipe(audioStream).pipe(pcmStream).pipe(deepgramSocket);

  ws.on('close', () => {
    console.log(`Call ended: ${callSid}`);
    deepgramSocket.finish();
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
