// app.js

const express = require('express');
const app = express();
const port = 3000;

// Middleware to parse JSON requests
app.use(express.json());

// Home route
app.get('/', (req, res) => {
    res.send('Hello, Express!');
});

// Sample API route
app.get('/api', (req, res) => {
    res.json({ message: 'Welcome to the API' });
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
