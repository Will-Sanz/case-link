export function pdfBase64DataUrl(base64: string): string {
  return `data:application/pdf;base64,${base64}`;
}
