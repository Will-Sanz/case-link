# Pin NODE_IMAGE to an approved digest when recording the deployment candidate.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src/lib/parent/documents.ts src/lib/parent/constants.ts ./src/lib/parent/
COPY scripts/parse-parent-document.ts ./scripts/
ENV TMPDIR=/work NODE_OPTIONS=--max-old-space-size=128 OMP_THREAD_LIMIT=1
USER 65534:65534
ENTRYPOINT ["node", "--import", "tsx", "scripts/parse-parent-document.ts"]
