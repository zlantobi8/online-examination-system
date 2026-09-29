// Vercel entry point. The Express app serves both the API and public frontend.
const { createApp } = require('../server/server');
module.exports = createApp();
