#!/usr/bin/env node
import express from "express";

const app = express();
const PORT = 3001;

app.get("/test", (req, res) => {
  res.json({ status: "ok" });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Test server on http://0.0.0.0:${PORT}`);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});

setTimeout(() => {
  console.log("Still running after 5 seconds...");
}, 5000);
