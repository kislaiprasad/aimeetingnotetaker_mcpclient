import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { processTranscriptText,processTranscriptFile } from "../client/app/meeting-service.js";

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    service: "AI Meeting Note Taker",
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/process-transcript-text", async (req, res) => {
  try {
    const { transcriptText, 
        transcriptFileName,
        spaceKey,
        parentPageId 
            } = req.body;

    if (!transcriptText) {
      return res.status(400).json({
        success: false,
        message: "transcriptText is required",
      });
    }

    const result = await processTranscriptText({
      transcriptText,
      transcriptFileName:
        transcriptFileName ||
        `transcript-${Date.now()}.txt`,
        spaceKey,
        parentPageId
    });

    res.json(result);
  } catch (error) {
    console.error("API Error:", error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/process-transcript-file", async (req, res) => {
  try {
    const {
      transcriptFileName,
      spaceKey,
      parentPageId
    } = req.body;

    if (!transcriptFileName) {
      return res.status(400).json({
        success: false,
        message: "transcriptFileName is required"
      });
    }

    const result =
      await processTranscriptFile({
        transcriptFileName,
        spaceKey,
        parentPageId
      });

    res.json(result);

  } catch (error) {

    console.error("API Error:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });

  }
});

app.listen(PORT, () => {
  console.log(
    `API Server running on http://localhost:${PORT}`
  );
});