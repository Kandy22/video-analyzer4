import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

// Load environment variables from .env and then .env.local
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ limit: "500mb", extended: true }));

  // Initialize Multer for temporary file uploads in the system temp directory
  const upload = multer({ dest: os.tmpdir() });

  // Initialize Gemini client lazily
  const getGeminiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing. Please set it in Settings.");
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  };

  // API Route for uploading file to Gemini Files API
  app.post("/api/upload", upload.single("file"), async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded." });
      }

      const ai = getGeminiClient();
      console.log(`[Server] Received file: ${req.file.originalname}. Uploading to Gemini...`);

      const uploadedFile = await ai.files.upload({
        file: req.file.path,
        config: {
          mimeType: req.file.mimetype,
          displayName: req.file.originalname,
        },
      });

      console.log(`[Server] File uploaded to Gemini: ${uploadedFile.name}. Waiting for PROCESSING state to clear...`);

      let getFile = await ai.files.get({ name: uploadedFile.name });
      while (getFile.state === "PROCESSING") {
        console.log(`[Server] File state is PROCESSING. Checking again in 3 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        getFile = await ai.files.get({ name: uploadedFile.name });
      }

      console.log(`[Server] File state finalized: ${getFile.state}`);

      // Clean up local temp file
      try {
        await fs.promises.unlink(req.file.path);
      } catch (err) {
        console.error("[Server] Error unlinking temporary file:", err);
      }

      if (getFile.state === "FAILED") {
        return res.status(500).json({ error: "File processing failed on Gemini." });
      }

      res.json(getFile);
    } catch (error: any) {
      console.error("[Server] Error in /api/upload:", error);
      res.status(500).json({ error: error.message || "Internal server error." });
    }
  });

  // API Route for chunked file uploads (bypassing 32MB Cloud Run proxy limits)
  app.post("/api/upload-chunk", upload.single("file"), async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No chunk file uploaded." });
      }

      const { uploadId, chunkIndex, totalChunks, fileName } = req.body || {};
      if (!uploadId || chunkIndex === undefined || !totalChunks || !fileName) {
        return res.status(400).json({ error: "Missing chunk metadata." });
      }

      const idx = parseInt(chunkIndex, 10);
      const total = parseInt(totalChunks, 10);

      // Sanitize the uploadId to prevent directory traversal
      const safeUploadId = uploadId.replace(/[^a-zA-Z0-9-]/g, "");
      const tempFilePath = path.join(os.tmpdir(), `upload_${safeUploadId}`);

      // Read chunk data and append to the temp file
      const chunkData = await fs.promises.readFile(req.file.path);
      
      if (idx === 0) {
        // First chunk: write file
        await fs.promises.writeFile(tempFilePath, chunkData);
      } else {
        // Subsequent chunks: append file
        await fs.promises.appendFile(tempFilePath, chunkData);
      }

      // Clean up multer's temporary chunk file
      try {
        await fs.promises.unlink(req.file.path);
      } catch (err) {
        console.error("[Server] Error unlinking chunk temp file:", err);
      }

      // Return fast chunk acknowledgement
      res.json({ status: "chunk_received", chunkIndex: idx, completed: idx === total - 1 });
    } catch (error: any) {
      console.error("[Server] Error in /api/upload-chunk:", error);
      // Ensure temp file cleanup on failure
      const { uploadId } = req.body || {};
      if (uploadId) {
        const safeUploadId = uploadId.replace(/[^a-zA-Z0-9-]/g, "");
        const tempFilePath = path.join(os.tmpdir(), `upload_${safeUploadId}`);
        if (fs.existsSync(tempFilePath)) {
          try {
            await fs.promises.unlink(tempFilePath);
          } catch (_) {}
        }
      }
      res.status(500).json({ error: error.message || "Internal server error during chunk upload." });
    }
  });

  // API Route for registering the completed upload with Gemini Files API
  app.post("/api/register-file", async (req: any, res: any) => {
    try {
      const { uploadId, fileName, mimeType } = req.body;
      if (!uploadId || !fileName) {
        return res.status(400).json({ error: "Missing uploadId or fileName." });
      }

      const safeUploadId = uploadId.replace(/[^a-zA-Z0-9-]/g, "");
      const tempFilePath = path.join(os.tmpdir(), `upload_${safeUploadId}`);

      if (!fs.existsSync(tempFilePath)) {
        return res.status(404).json({ error: "Uploaded file not found or already processed." });
      }

      console.log(`[Server] Registering file to Gemini Files API: ${fileName} (${fs.statSync(tempFilePath).size} bytes)`);
      const ai = getGeminiClient();

      const uploadedFile = await ai.files.upload({
        file: tempFilePath,
        config: {
          mimeType: mimeType || "video/mp4",
          displayName: fileName,
        },
      });

      console.log(`[Server] File uploaded to Gemini: ${uploadedFile.name}.`);

      // Clean up the reconstructed temp file immediately
      try {
        await fs.promises.unlink(tempFilePath);
      } catch (err) {
        console.error("[Server] Error unlinking final reconstructed temp file:", err);
      }

      return res.json(uploadedFile);
    } catch (error: any) {
      console.error("[Server] Error in /api/register-file:", error);
      res.status(500).json({ error: error.message || "Internal server error during Gemini registration." });
    }
  });

  // API Route for polling a file's processing status from Gemini Files API
  app.get("/api/file-status", async (req: any, res: any) => {
    try {
      const { name } = req.query;
      if (!name) {
        return res.status(400).json({ error: "Missing name parameter." });
      }

      const ai = getGeminiClient();
      const getFile = await ai.files.get({ name });
      return res.json(getFile);
    } catch (error: any) {
      console.error("[Server] Error in /api/file-status:", error);
      res.status(500).json({ error: error.message || "Internal server error fetching file status." });
    }
  });

  // API Route for checking configuration status
  app.get("/api/config-status", (req: any, res: any) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const hasKey = !!apiKey;
    const isMock = !apiKey || apiKey === "PLACEHOLDER" || apiKey.includes("your_api_key_here") || apiKey.length < 20;
    res.json({
      configured: hasKey && !isMock,
      hasKey,
      isPlaceholder: isMock,
    });
  });

  // API Route for listing files from Gemini Files API
  app.get("/api/files", async (req: any, res: any) => {
    try {
      const ai = getGeminiClient();
      console.log(`[Server] Listing files from Gemini...`);
      const response = await ai.files.list({ config: { pageSize: 10 } });
      res.json(response.page || []);
    } catch (error: any) {
      console.error("[Server] Error in /api/files:", error);
      res.status(500).json({ error: error.message || "Internal server error." });
    }
  });

  // API Route for generating content from video and prompt
  app.post("/api/generate", async (req: any, res: any) => {
    try {
      const { prompt, file, functionDeclarations } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required." });
      }

      const ai = getGeminiClient();

      if (!file) {
        // Safe, highly realistic simulated offline mode when no file is uploaded yet
        console.log(`[Server] Running generateContent in simulation mode (no file attached).`);
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [{ text: `${prompt}\n\nPlease generate a realistic simulated behavioral assessment clinical dialogue with vocal pacing details.` }],
            },
          ],
          config: {
            systemInstruction: "Act as an Audio-Only transcription and behavioral metrics clinical pipeline. Since no file is attached, generate a highly realistic clinical dialogue transcript and simulated speech-only diagnostic metrics (including hesitation intervals, speech rate velocity spikes, sentence-deferral hedging patterns, and sudden interruptions) for the requested mode using the provided tools. Call the relevant function with appropriate timecodes and text.",
            temperature: 0.7,
            tools: functionDeclarations ? [{ functionDeclarations }] : undefined,
          },
        });

        return res.json({
          text: response.text,
          functionCalls: response.functionCalls,
        });
      }

      console.log(`[Server] Running generateContent with prompt and file: ${file.name}`);

      // Ensure the file exists and is in the ACTIVE state before calling generateContent
      let fileStatus;
      try {
        fileStatus = await ai.files.get({ name: file.name });
      } catch (err: any) {
        console.error(`[Server] Failed to fetch file status for ${file.name}:`, err);
        return res.status(400).json({
          error: "The referenced video session has expired or no longer exists on the Gemini server. Please re-upload your file.",
        });
      }

      let attempts = 0;
      const maxAttempts = 60; // Wait up to 3 minutes
      while (fileStatus && fileStatus.state === "PROCESSING" && attempts < maxAttempts) {
        console.log(`[Server] File ${file.name} is still PROCESSING. Waiting 3 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        try {
          fileStatus = await ai.files.get({ name: file.name });
        } catch (err: any) {
          console.error(`[Server] Failed to fetch file status during wait for ${file.name}:`, err);
          return res.status(400).json({
            error: "The referenced video session was lost or deleted during processing. Please re-upload.",
          });
        }
        attempts++;
      }

      if (!fileStatus || fileStatus.state === "FAILED") {
        return res.status(400).json({ error: "The video track processing failed on the Gemini backend. Please try another file." });
      }

      if (fileStatus.state !== "ACTIVE") {
        return res.status(400).json({ error: `The file is not in an ACTIVE state (current state: ${fileStatus.state || "UNKNOWN"}). Please wait or re-upload.` });
      }

      // Robust retry mechanism in case the file is ACTIVE on the Files API but not yet replicated on generateContent
      let response;
      let generateAttempts = 0;
      const maxGenerateAttempts = 5;
      while (generateAttempts < maxGenerateAttempts) {
        try {
          response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  {
                    fileData: {
                      mimeType: fileStatus.mimeType,
                      fileUri: fileStatus.uri,
                    },
                  },
                ],
              },
            ],
            config: {
              systemInstruction: "When given a video and a query, call the relevant function only once with the appropriate timecodes and text for the video",
              temperature: 0.5,
              tools: functionDeclarations ? [{ functionDeclarations }] : undefined,
            },
          });
          break; // Success! Break out of retry loop.
        } catch (genErr: any) {
          const errMsg = genErr.message || "";
          if (errMsg.includes("not in an ACTIVE state") && generateAttempts < maxGenerateAttempts - 1) {
            console.log(`[Server] Gemini reported file not active yet during generation. Retrying in 4 seconds... (Attempt ${generateAttempts + 1}/${maxGenerateAttempts})`);
            await new Promise((resolve) => setTimeout(resolve, 4000));
            generateAttempts++;
          } else {
            throw genErr; // Re-throw any other error or if we exhausted retries
          }
        }
      }

      res.json({
        text: response.text,
        functionCalls: response.functionCalls,
      });
    } catch (error: any) {
      console.error("[Server] Error in /api/generate:", error);
      res.status(500).json({ error: error.message || "Internal server error." });
    }
  });

  // Global API error handler to guarantee all API failures return JSON, never HTML
  app.use("/api/*all", (err: any, req: any, res: any, next: any) => {
    console.error("[Server API Error Handler]", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal server error during API execution.",
    });
  });

  // Serve Vite app in dev, or static files in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Full-stack application running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
