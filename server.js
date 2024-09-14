require("dotenv").config();
const express = require("express");
const expressWs = require("express-ws");
const websocketStream = require("websocket-stream/stream");
const { Transform } = require("stream");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const Twilio = require("twilio");
const path = require("path");

const app = express();
expressWs(app);

const twilioClient = Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// Serve static files from the 'public' directory
app.use(express.static("public"));

// Set up Handlebars view engine
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

// Twilio webhook endpoint for incoming calls
app.post("/twiml", (req, res) => {
  console.log("/twiml accessed");
  console.log(req.body);
  res.set("Content-Type", "application/xml");
  res.render("twiml", { host: req.hostname });
});

// WebSocket endpoint for Twilio Media Streams
app.ws("/media", (ws, req) => {
  console.log("/media accessed");

  const mediaStream = websocketStream(ws, { objectMode: true });

  mediaStream.on("data", (chunk) => {
    console.log("Received data from Twilio:", chunk.toString("utf8"));
  });

  let callSid;

  // Transform stream to extract audio from Twilio messages
  const audioStream = new Transform({
    objectMode: true,
    transform: (chunk, encoding, callback) => {
      let msg;
      try {
        msg = JSON.parse(chunk.toString("utf8"));
      } catch (error) {
        console.error("Failed to parse JSON:", error);
        return callback();
      }

      console.log(`Received Twilio message: ${msg.event}`);

      if (msg.event === "start") {
        callSid = msg.start.callSid;
        console.log(`Call started: ${callSid}`);
        callback();
      } else if (msg.event === "media") {
        const payload = Buffer.from(msg.media.payload, "base64");
        console.log(`Received audio payload from Twilio: ${payload.length} bytes`);
        this.push(payload);
        callback();
      } else if (msg.event === "stop") {
        console.log(`Call stopped: ${callSid}`);
        callback();
      } else {
        callback();
      }
    },
  });

  // Set up Deepgram's live transcription socket
  const deepgramSocket = deepgram.transcription.live({
    encoding: "mulaw", // Since Twilio sends μ-law audio
    sample_rate: 8000,
    punctuate: true,
    interim_results: false,
    language: "en-US",
  });

  deepgramSocket.on(LiveTranscriptionEvents.Open, () => {
    console.log("Deepgram connection opened.");
  });

  deepgramSocket.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript) {
      console.log(`Transcription: ${transcript}`);
      // Here you can pass the transcription to the frontend or another service
    }
  });

  deepgramSocket.on(LiveTranscriptionEvents.Close, () => {
    console.log("Deepgram connection closed.");
  });

  deepgramSocket.on(LiveTranscriptionEvents.Error, (error) => {
    console.error("Deepgram error:", error);
  });

  // Pipe the audio stream directly to Deepgram
  mediaStream.pipe(audioStream).pipe(deepgramSocket);

  // Handle stream errors
  audioStream.on("error", (error) => {
    console.error("Audio Stream error:", error);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  ws.on("close", () => {
    console.log(`WebSocket closed for call: ${callSid}`);
    deepgramSocket.finish();
  });
});

app.get("/", (req, res) => {
  console.log("/endpoint accessed");
  res.send("Hello from your server!");
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

