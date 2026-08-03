export type DemoRequestDetails = {
  name: string;
  email: string;
  organization: string;
  role: string;
  message: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildDemoRequestMessage(details: DemoRequestDetails, receivedAt: Date) {
  const message = details.message.trim() || "No additional details provided.";
  const received = receivedAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  });
  const subject = `New CaseLink demo request — ${singleLine(details.organization)}`;
  const text = [
    "New CaseLink demo request",
    "",
    `Name: ${details.name}`,
    `Work email: ${details.email}`,
    `School or district: ${details.organization}`,
    `Role: ${details.role}`,
    `Received: ${received} ET`,
    "",
    "Paperwork context:",
    message,
  ].join("\n");
  const rows = [
    ["Name", details.name],
    ["Work email", details.email],
    ["School or district", details.organization],
    ["Role", details.role],
    ["Received", `${received} ET`],
  ];
  const html = `
    <div style="font-family:Arial,sans-serif;color:#173a15;line-height:1.55;max-width:640px;margin:0 auto;padding:24px">
      <h1 style="font-size:24px;margin:0 0 20px">New CaseLink demo request</h1>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        ${rows.map(([label, value]) => `<tr><th style="padding:8px 12px 8px 0;text-align:left;vertical-align:top;color:#5d705a;font-size:13px">${escapeHtml(label)}</th><td style="padding:8px 0;font-size:14px">${escapeHtml(value)}</td></tr>`).join("")}
      </table>
      <h2 style="font-size:16px;margin:0 0 8px">Paperwork context</h2>
      <div style="white-space:pre-wrap;background:#f6f8f4;border:1px solid #dce6d9;border-radius:8px;padding:16px;font-size:14px">${escapeHtml(message)}</div>
    </div>
  `.trim();

  return { subject, text, html };
}
