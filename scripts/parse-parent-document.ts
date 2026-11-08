import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { inspectDocument, MAX_DOCUMENT_BYTES } from "../src/lib/parent/documents";

const run = promisify(execFile);
const limits = { encoding: "utf8" as const, timeout: 30000, maxBuffer: 300000, killSignal: "SIGKILL" as const, env: { NODE_ENV: "production" as const, PATH: process.env.PATH, LANG: "C.UTF-8", OMP_THREAD_LIMIT: "1" } };

async function main() {
  const mediaType = process.argv[2];
  if (!["application/pdf", "image/jpeg", "image/png"].includes(mediaType)) throw new Error("Unsupported document type.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > MAX_DOCUMENT_BYTES) throw new Error("Document limit exceeded."); chunks.push(Buffer.from(chunk)); }
  const bytes = Buffer.concat(chunks);
  const directory = await mkdtemp(join(tmpdir(), "caselink-document-"));
  await chmod(directory, 0o700);
  try {
    const source = join(directory, "source");
    await writeFile(source, bytes, { mode: 0o600 });
    const inspected = await inspectDocument(bytes, mediaType);
    const pages: string[] = [];
    if (mediaType === "application/pdf") {
      const native = await run("pdftotext", ["-layout", "-f", "1", "-l", String(inspected.pageCount), source, "-"], limits);
      const extracted = native.stdout.split("\f");
      for (let page = 1; page <= inspected.pageCount; page++) {
        let text = extracted[page - 1] ?? "";
        if (text.replace(/\s/g, "").length < 30) {
          const image = join(directory, `page-${page}`);
          await run("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "1600", "-png", source, image], limits);
          await chmod(`${image}.png`, 0o600);
          text = (await run("tesseract", [`${image}.png`, "stdout", "-l", "eng+spa", "--psm", "3"], limits)).stdout;
        }
        if (text.length > 50000) throw new Error("Page text exceeds the supported limit.");
        pages.push(text);
      }
    } else {
      const text = (await run("tesseract", [source, "stdout", "-l", "eng+spa", "--psm", "3"], limits)).stdout;
      if (text.length > 50000) throw new Error("Page text exceeds the supported limit.");
      pages.push(text);
    }
    // Only stdout carries source text; callers must never log it or parser diagnostics.
    process.stdout.write(JSON.stringify({ sourcePages: pages, pageCount: inspected.pageCount, mediaType: inspected.mediaType }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

main().catch(() => { process.stderr.write("The isolated document reader could not process this file safely.\n"); process.exitCode = 1; });
