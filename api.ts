/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

async function generateContent(
  text: string,
  functionDeclarations: any[],
  file: any,
) {
  // Strip off non-serializable properties like callbacks
  const cleanedDecls = functionDeclarations.map((fn) => ({
    name: fn.name,
    description: fn.description,
    parameters: fn.parameters,
  }));

  const res = await fetch("/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: text,
      file,
      functionDeclarations: cleanedDecls,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server error: ${res.status}`);
  }

  return await res.json();
}

async function uploadFile(file: File, onProgress?: (pct: number) => void) {
  const chunkSize = 15 * 1024 * 1024; // 15MB chunks to stay safely under the 32MB Cloud Run request limit
  const totalChunks = Math.ceil(file.size / chunkSize);
  const uploadId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunkBlob = file.slice(start, end);

    const formData = new FormData();
    // We pass a third argument to append() to preserve the original file name in multipart header
    formData.append("file", chunkBlob, file.name);
    formData.append("uploadId", uploadId);
    formData.append("chunkIndex", chunkIndex.toString());
    formData.append("totalChunks", totalChunks.toString());
    formData.append("fileName", file.name);
    formData.append("mimeType", file.type || "video/mp4");

    const res = await fetch("/api/upload-chunk", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server error: ${res.status} at chunk ${chunkIndex + 1}/${totalChunks}`);
    }

    await res.json();
    
    if (onProgress) {
      // Scale chunk progress up to 95% to leave room for the final registration step
      const percent = Math.round(((chunkIndex + 1) / totalChunks) * 95);
      onProgress(percent);
    }
  }

  if (onProgress) {
    onProgress(98);
  }

  // Chunks uploaded successfully. Now request the server to register with Gemini.
  const registerRes = await fetch("/api/register-file", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uploadId,
      fileName: file.name,
      mimeType: file.type || "video/mp4",
    }),
  });

  if (!registerRes.ok) {
    const errData = await registerRes.json().catch(() => ({}));
    throw new Error(errData.error || `Registration error: ${registerRes.status}`);
  }

  const fileMetadata = await registerRes.json();

  if (onProgress) {
    onProgress(100);
  }

  return fileMetadata;
}

async function listFiles() {
  const res = await fetch("/api/files");
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server error: ${res.status}`);
  }
  return await res.json();
}

async function getFileStatus(name: string) {
  const res = await fetch(`/api/file-status?name=${encodeURIComponent(name)}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server error: ${res.status}`);
  }
  return await res.json();
}

export { generateContent, uploadFile, listFiles, getFileStatus };
