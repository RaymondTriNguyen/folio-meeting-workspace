import { timestamp, type Meeting } from "./domain";

export function meetingMarkdown(
  meeting: Meeting,
  options: { includeTranscript?: boolean } = {},
): string {
  const lines = [
    `# ${meeting.title}`,
    "",
    `Project: ${meeting.project}`,
    `Date: ${meeting.createdAt.slice(0, 10)}`,
    `Participants: ${meeting.participants.join(", ") || "Not specified"}`,
    "",
    "## Executive summary",
    "",
    meeting.summary,
  ];
  if (meeting.topics.length)
    lines.push(
      "",
      "## Discussion topics",
      ...meeting.topics.flatMap((t) => ["", `### ${t.title}`, t.summary]),
    );
  const sections = {
    requirement: "Requirements",
    decision: "Decisions",
    action: "Action items",
    risk: "Risks & concerns",
    question: "Open questions",
  } as const;
  for (const [kind, label] of Object.entries(sections)) {
    const items = meeting.items.filter((i) => i.kind === kind);
    lines.push("", `## ${label}`, "");
    if (!items.length) lines.push("None recorded.");
    for (const item of items) {
      const segment = meeting.transcript.find((s) => s.id === item.segmentId);
      lines.push(
        `- ${kind === "action" ? `[${item.completed ? "x" : " "}] ` : ""}${item.text}`,
        `  Priority: ${item.priority} | Owner: ${item.owner || "Unassigned"} | Due: ${item.dueDate || "Not specified"}`,
        `  Review: ${item.review}${item.inferred ? " (inferred)" : ""} | Source: ${timestamp(segment?.start)}`,
        `  Evidence: "${item.evidence || "Manually added; no source evidence."}"`,
      );
    }
  }
  if (options.includeTranscript)
    lines.push(
      "",
      "## Transcript",
      "",
      ...meeting.transcript.map(
        (s) => `[${timestamp(s.start)}] ${s.speaker}: ${s.text}`,
      ),
    );
  return lines.join("\n");
}
function download(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function buildExport(
  meeting: Meeting,
  format: "md" | "docx" | "pdf",
  options: { includeTranscript?: boolean } = {},
) {
  const markdown = meetingMarkdown(meeting, options);
  if (format === "md")
    return new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  if (format === "docx") {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } =
      await import("docx");
    const doc = new Document({
      creator: "Folio",
      title: meeting.title,
      sections: [
        {
          properties: {},
          children: markdown.split("\n").map((line) => {
            const heading = line.startsWith("### ")
              ? HeadingLevel.HEADING_2
              : line.startsWith("## ")
                ? HeadingLevel.HEADING_1
                : line.startsWith("# ")
                  ? HeadingLevel.TITLE
                  : undefined;
            return new Paragraph({
              heading,
              spacing: { after: heading ? 180 : 100 },
              children: [
                new TextRun({
                  text: line.replace(/^#{1,3} /, ""),
                  font: "Calibri",
                  size: heading ? 28 : 22,
                }),
              ],
            });
          }),
        },
      ],
    });
    return Packer.toBlob(doc);
  }
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(meeting.title);
  pdf.setAuthor("Folio");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = 785;
  const addPage = () => {
    page = pdf.addPage([595, 842]);
    y = 785;
  };
  for (const raw of markdown.split("\n")) {
    const heading = raw.startsWith("#");
    const size = raw.startsWith("# ") ? 22 : heading ? 14 : 10;
    const font = heading ? bold : regular;
    const text = raw
      .replace(/^#{1,3} /, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]/g, "?");
    if (!text) {
      y -= 10;
      continue;
    }
    if (y < 85) addPage();
    const words = text.split(/\s+/).flatMap((word) => {
      const parts: string[] = [];
      let part = "";
      for (const char of word) {
        if (font.widthOfTextAtSize(part + char, size) > 470) {
          parts.push(part);
          part = "";
        }
        part += char;
      }
      if (part) parts.push(part);
      return parts;
    });
    let line = "";
    for (const word of words) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > 475) {
        page.drawText(line, {
          x: 60,
          y,
          size,
          font,
          color: rgb(0.12, 0.2, 0.18),
        });
        y -= size * 1.5;
        if (y < 60) addPage();
        line = word;
      } else line += `${line ? " " : ""}${word}`;
    }
    if (line) {
      page.drawText(line, {
        x: 60,
        y,
        size,
        font,
        color: rgb(0.12, 0.2, 0.18),
      });
      y -= size * 1.5 + (heading ? 8 : 0);
    }
  }
  pdf.getPages().forEach((p, i) =>
    p.drawText(`FOLIO  /  ${i + 1} of ${pdf.getPageCount()}`, {
      x: 60,
      y: 30,
      size: 8,
      font: regular,
      color: rgb(0.45, 0.5, 0.48),
    }),
  );
  return new Blob([new Uint8Array(await pdf.save())], {
    type: "application/pdf",
  });
}
export async function exportMeeting(
  meeting: Meeting,
  format: "md" | "docx" | "pdf",
  options: { includeTranscript?: boolean } = {},
) {
  const name =
    meeting.title.replace(/[^\p{L}\p{N} -]/gu, "").trim() || "meeting";
  const artifact = await buildExport(meeting, format, options);
  download(artifact, artifact.type, `${name}.${format}`);
}
