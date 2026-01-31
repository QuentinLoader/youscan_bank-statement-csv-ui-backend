import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Basic route to verify the server is alive
app.get('/', (req, res) => {
  res.send('✅ SlimJan UI is running inside the container!');
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});