// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ParentDocument } from "@/lib/parent/domain";
import { ParentLocaleProvider } from "./parent-locale";
import { SupportDocuments } from "./support-documents";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const requestId = "11111111-1111-4111-8111-111111111111";
const document: ParentDocument = { id: "22222222-2222-4222-8222-222222222222", request_id: requestId,
  filename: "Aviso de José.pdf", media_type: "application/pdf", size_bytes: 10, status: "uploaded",
  expires_at: "2026-11-18T02:30:00Z", created_at: "2026-11-11T02:30:00Z" };
function show(documents: ParentDocument[] = [], inactive = false, onChange = vi.fn()) {
  return render(<ParentLocaleProvider initialLocale="es"><SupportDocuments requestId={requestId}
    documents={documents} inactive={inactive} onChange={onChange} /></ParentLocaleProvider>);
}
function consent() {
  fireEvent.click(screen.getByText("Añadir un documento o tomar una foto"));
  fireEvent.click(screen.getByRole("checkbox"));
}

it("explains Spanish consent, manual alternatives and retention before exposing either capture input", () => {
  show();
  expect(screen.getByRole("heading", { name: "Facturas y documentos" }).closest("section")?.lang).toBe("es");
  expect(screen.getByText(/Puede introducir la información manualmente/)).toBeTruthy();
  expect(screen.queryByLabelText("Elegir una factura o un aviso")).toBeNull();
  fireEvent.click(screen.getByText("Añadir un documento o tomar una foto"));
  expect(screen.getByText(/Su plazo inicial de conservación es de siete días/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Leer los detalles de privacidad de los documentos." }).getAttribute("href")).toBe("/support/privacy#documents");
  expect(screen.queryByLabelText("Tomar una foto")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByLabelText("Elegir una factura o un aviso").getAttribute("accept")).toBe("image/jpeg,image/png,application/pdf");
  expect(screen.getByLabelText("Tomar una foto").getAttribute("capture")).toBe("environment");
  fireEvent.change(screen.getByLabelText("Elegir una factura o un aviso"), { target: { files: [new File(["fixture"], "Aviso.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.queryByLabelText("Tomar una foto")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  expect((screen.getByRole("button", { name: "Cargar de forma privada" }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps the upload size guard and actionable Spanish error without sending the file", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); show(); consent();
  const file = new File(["fixture"], "Aviso.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: 10485761 });
  fireEvent.change(screen.getByLabelText("Elegir una factura o un aviso"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Cargar de forma privada" }));
  const error = await screen.findByRole("alert");
  expect(error.textContent).toBe("Elija un JPEG, PNG o PDF legible de hasta 10 MB. Los PDF pueden tener hasta cinco páginas.");
  expect(error.lang).toBe("es"); expect(fetcher).not.toHaveBeenCalled();
});

it("changes only display copy while preserving the exact consented upload and success callback", async () => {
  const fetcher = vi.fn().mockImplementation(async (_url, init) => Response.json({ ok: true, receipt: { state: "confirmed", document: {
    ...document, upload_key: new Headers(init.headers).get("Idempotency-Key"), upload_confirmed_at: "2026-11-11T02:30:01Z",
  } } })); vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn(); show([], false, changed); consent();
  const file = new File(["synthetic bytes"], "Aviso de José.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Elegir una factura o un aviso"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Cargar de forma privada" }));
  expect((await screen.findByRole("status")).textContent).toBe("El documento se guardó de forma privada. Su estado aparecerá aquí.");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(`/api/parent/requests/${requestId}/documents`); expect(init.method).toBe("POST");
  expect(init.body.get("file")).toBe(file); expect(init.body.get("consent")).toBe("1");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Tomar una foto")).toBeNull();
});

it("translates document state and the same Eastern expiry date while preserving filenames", () => {
  show([document]);
  expect(screen.getByText("Aviso de José.pdf")).toBeTruthy();
  expect(screen.getByText("cargado").lang).toBe("es");
  expect(screen.getByText(/El archivo original vence el/).textContent).toContain("17 nov 2026");
  expect(screen.getByRole("button", { name: "Eliminar Aviso de José.pdf" })).toBeTruthy();
});

it("explains the actual unsafe-file rejection in Spanish and preserves the chosen file for correction", async () => {
  const message = "We couldn't read this file safely. Use a plain JPEG, PNG or unencrypted PDF with up to five pages, or enter information manually.";
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: false, error: message }, { status: 400 }));
  vi.stubGlobal("fetch", fetcher); const changed = vi.fn(); show([], false, changed); consent();
  const file = new File(["not PDF bytes"], "Aviso.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Elegir una factura o un aviso"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Cargar de forma privada" }));
  const error = await screen.findByRole("alert");
  expect(error.lang).toBe("es"); expect(error.textContent).toContain("de hasta cinco páginas, o introduzca la información manualmente");
  expect(screen.getByText("Aviso.pdf")).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(changed).not.toHaveBeenCalled();
});

it("retains unknown recorded states as English text without reading prototype properties", () => {
  show([{ ...document, status: "__proto__" }]);
  const status = screen.getByText("proto", { exact: false });
  expect(status.lang).toBe("en"); expect(status.textContent).toBe("  proto  ");
});

it("retains private-deletion controls after work stops and preserves the recipient-copy limit", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn(); show([{ ...document, status: "raw_deleted" }], true, changed);
  expect(screen.getByText("Se eliminó el archivo original; los datos validados se conservan")).toBeTruthy();
  expect(screen.queryByText("Añadir un documento o tomar una foto")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Eliminar Aviso de José.pdf" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect((await screen.findByRole("status")).textContent).toContain("no se pueda retirar la información ya entregada a un programa");
  expect(fetcher.mock.calls[0][0]).toBe(`/api/parent/requests/${requestId}/documents/${document.id}`);
  expect(fetcher.mock.calls[0][1].method).toBe("DELETE");
});

it("keeps an unrecognized server error in its original language", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Unrecognized recorded service issue" }, { status: 503 })));
  show([document]); fireEvent.click(screen.getByRole("button", { name: "Eliminar Aviso de José.pdf" }));
  const error = await screen.findByRole("alert");
  expect(error.textContent).toBe("Unrecognized recorded service issue"); expect(error.lang).toBe("en");
});
