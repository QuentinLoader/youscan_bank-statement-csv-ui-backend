import app from "./app.js";

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SlimJan backend running on port ${PORT}`);
});
