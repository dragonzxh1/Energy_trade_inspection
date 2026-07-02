"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "../../app/admin/upload/upload.module.css";

type WorkflowType = "A" | "B";
type UploadState = "idle" | "uploading" | "processing" | "done" | "error";

interface DifyResult {
  success: boolean;
  workflow: string;
  workflow_run_id: string;
  elapsed: number;
  tokens: number;
  outputs?: Record<string, unknown>;
  error?: string;
}

export default function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowType>("B");
  const [state, setState] = useState<UploadState>("idle");
  const [result, setResult] = useState<DifyResult | null>(null);
  const [progress, setProgress] = useState("");

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) setFile(f);
    },
    []
  );

  const handleUpload = async () => {
    if (!file) return;
    setState("uploading");
    setProgress("Uploading to Dify...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("workflow", workflow);

      setProgress(
        workflow === "B"
          ? "Running OCR + Workflow B..."
          : "Running Workflow A..."
      );

      const res = await fetch("/api/admin/dify", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setResult(data);
        setState("done");
      } else {
        setResult(data);
        setState("error");
      }
    } catch (err) {
      setResult({
        success: false,
        workflow: "",
        workflow_run_id: "",
        elapsed: 0,
        tokens: 0,
        error: String(err),
      });
      setState("error");
    }
  };

  const workflowA = workflow === "A";
  const acceptFormats = workflowA
    ? ".pdf,.docx,.xlsx"
    : ".jpg,.jpeg,.png,.webp";

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button
          onClick={() => router.back()}
          className={styles.backBtn}
        >
          ← Back to Admin
        </button>
        <h1 className={styles.title}>Upload to Dify Workflow</h1>
      </div>

      {/* Workflow selector */}
      <div className={styles.selector}>
        <button
          className={`${styles.wfBtn} ${workflow === "B" ? styles.active : ""}`}
          onClick={() => setWorkflow("B")}
        >
          <span className={styles.wfIcon}>📊</span>
          <div>
            <strong>Workflow B — Quotes OCR</strong>
            <p>Upload Platts summary image → extract daily quotes</p>
          </div>
        </button>
        <button
          className={`${styles.wfBtn} ${workflow === "A" ? styles.active : ""}`}
          onClick={() => setWorkflow("A")}
        >
          <span className={styles.wfIcon}>📄</span>
          <div>
            <strong>Workflow A — Document Analyzer</strong>
            <p>Upload PDF/DOCX/XLSX → analyze & generate article</p>
          </div>
        </button>
      </div>

      {/* Drop zone */}
      <div
        className={`${styles.dropZone} ${file ? styles.hasFile : ""}`}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {file ? (
          <div className={styles.fileInfo}>
            <span className={styles.fileIcon}>
              {file.type.startsWith("image/") ? "🖼️" : "📄"}
            </span>
            <div>
              <p className={styles.fileName}>{file.name}</p>
              <p className={styles.fileSize}>
                {(file.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <button
              onClick={() => {
                setFile(null);
                setState("idle");
                setResult(null);
              }}
              className={styles.removeBtn}
            >
              ✕
            </button>
          </div>
        ) : (
          <>
            <p className={styles.dropText}>
              Drop {workflowA ? "PDF/DOCX/XLSX" : "Platts image"} here
            </p>
            <p className={styles.dropHint}>or click to browse</p>
            <input
              type="file"
              accept={acceptFormats}
              onChange={handleFileChange}
              className={styles.fileInput}
            />
          </>
        )}
      </div>

      {/* Upload button */}
      <button
        onClick={handleUpload}
        disabled={!file || state === "uploading" || state === "processing"}
        className={styles.uploadBtn}
      >
        {state === "uploading" || state === "processing"
          ? "⏳ Processing..."
          : "▶ Run Workflow"}
      </button>

      {/* Progress */}
      {progress && state === "uploading" && (
        <p className={styles.progress}>{progress}</p>
      )}

      {/* Result */}
      {result && (state === "done" || state === "error") && (
        <div
          className={`${styles.result} ${
            state === "error" ? styles.error : ""
          }`}
        >
          <h3>
            {state === "done" ? "✅ Workflow Complete" : "❌ Error"}
          </h3>
          {result.workflow_run_id && (
            <p className={styles.meta}>
              Run ID: {result.workflow_run_id} | Elapsed:{" "}
              {result.elapsed?.toFixed(1)}s | Tokens: {result.tokens}
            </p>
          )}
          {result.error && (
            <p className={styles.errMsg}>{result.error}</p>
          )}
          {result.outputs && (
            <pre className={styles.output}>
              {JSON.stringify(result.outputs, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
