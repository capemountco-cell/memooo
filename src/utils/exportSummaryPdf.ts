import jsPDF from 'jspdf';
import evolveLogo from '@/assets/evolve-logo-grey.svg';
import { stripMarkdownInline } from './markdown';
import { parseSpeakerTurns, buildSpeakerColorMap, SPEAKER_PALETTE } from '@/utils/speakerTranscript';


/* ------------------------------------------------------------------ *
 * Editorial meeting-notes PDF export (US Letter, points)
 * ------------------------------------------------------------------ */

const PAGE_W = 612; // 8.5in
const PAGE_H = 792; // 11in
const IN = 72;

const MARGIN_TOP = 0.64 * IN;
const MARGIN_X = 0.72 * IN;
const MARGIN_BOTTOM = 0.58 * IN;

const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_BOTTOM = PAGE_H - MARGIN_BOTTOM;

const TOPBAR_H = 0.34 * IN;
const HEADER_GAP = 0.26 * IN;
const BODY_TOP = MARGIN_TOP + TOPBAR_H + HEADER_GAP;

const LOGO_W = 0.78 * IN;
const LOGO_RATIO = 287 / 1260;

const INK: [number, number, number] = [0x11, 0x11, 0x0f];
const RULE: [number, number, number] = [0xd8, 0xd7, 0xd2];
const RULE_SOFT: [number, number, number] = [0xde, 0xdd, 0xd8];
const MUTED: [number, number, number] = [0x9a, 0x99, 0x94];
const MUTED_LIGHT: [number, number, number] = [0xaa, 0xa9, 0xa5];

const SERIF = 'times';
const SANS = 'helvetica';

export interface PdfSession {
  title?: string | null;
  started_at?: string | null;
}
export interface PdfSummary {
  overview?: string | null;
  key_topics?: string[] | null;
  decisions?: string[] | null;
  questions?: string[] | null;
  risks?: string[] | null;
  followups?: string[] | null;
  dates?: any;
  participants?: string[] | null;
}
export interface PdfTask {
  title: string;
  owner?: string | null;
  due_at?: string | null;
  status?: string;
}

export interface ExportPdfInput {
  session: PdfSession | null;
  summary: PdfSummary | null;
  tasks: PdfTask[];
  transcript: string;
}

/* ---------------------------- helpers ----------------------------- */

const formatDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

const clean = (v: unknown): string =>
  typeof v === 'string' ? stripMarkdownInline(v) : '';

const listOf = (v?: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (typeof item === 'string') return clean(item);
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const label = clean(o.title ?? o.name ?? o.label ?? o.text ?? o.date ?? o.event);
        const extra = clean(o.date ?? o.due ?? o.when ?? o.owner);
        if (label && extra && extra !== label) return `${label} — ${extra}`;
        return label || clean(JSON.stringify(item));
      }
      return '';
    })
    .filter(Boolean);
};

/** Rasterize the tiny EVOLVE mark to a PNG data URL (jsPDF cannot embed SVG). */
const loadLogoPng = async (): Promise<{ data: string; w: number; h: number } | null> => {
  try {
    const scale = 6;
    const w = Math.round(LOGO_W * scale);
    const h = Math.round(LOGO_W * LOGO_RATIO * scale);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    const loaded = new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
    });
    img.src = evolveLogo;
    const ok = await loaded;
    if (!ok) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.globalAlpha = 0.75;
    ctx.drawImage(img, 0, 0, w, h);
    return { data: canvas.toDataURL('image/png'), w: LOGO_W, h: LOGO_W * LOGO_RATIO };
  } catch {
    return null;
  }
};

type Ctx = {
  pdf: jsPDF;
  y: number;
  page: number;
  headerLabel: string;
  footerLeft: string;
  logo: { data: string; w: number; h: number } | null;
};

const setFill = (pdf: jsPDF, c: [number, number, number]) => pdf.setTextColor(c[0], c[1], c[2]);

const tracked = (
  pdf: jsPDF,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: 'left' | 'right' = 'left'
) => {
  const letters = [...text];
  const width =
    letters.reduce((acc, ch) => acc + pdf.getTextWidth(ch), 0) + tracking * (letters.length - 1);
  let cx = align === 'right' ? x - width : x;
  letters.forEach((ch) => {
    pdf.text(ch, cx, y);
    cx += pdf.getTextWidth(ch) + tracking;
  });
  return width;
};

const rule = (ctx: Ctx, color: [number, number, number] = RULE, width = CONTENT_W) => {
  ctx.pdf.setDrawColor(color[0], color[1], color[2]);
  ctx.pdf.setLineWidth(0.5);
  ctx.pdf.line(MARGIN_X, ctx.y, MARGIN_X + width, ctx.y);
};

const drawHeader = (ctx: Ctx) => {
  const { pdf } = ctx;
  pdf.setFont(SANS, 'normal');
  pdf.setFontSize(8.2);
  setFill(pdf, MUTED);
  tracked(pdf, ctx.headerLabel.toUpperCase(), MARGIN_X, MARGIN_TOP + 8, 8.2 * 0.19);

  if (ctx.logo) {
    pdf.addImage(
      ctx.logo.data,
      'PNG',
      PAGE_W - MARGIN_X - ctx.logo.w,
      MARGIN_TOP + 1,
      ctx.logo.w,
      ctx.logo.h
    );
  }
};

const drawFooter = (ctx: Ctx) => {
  const { pdf } = ctx;
  const y = PAGE_H - MARGIN_BOTTOM + 14;
  pdf.setFont(SANS, 'normal');
  pdf.setFontSize(7.5);
  setFill(pdf, MUTED_LIGHT);
  tracked(pdf, ctx.footerLeft.toUpperCase(), MARGIN_X, y, 7.5 * 0.16);
  tracked(pdf, String(ctx.page).padStart(2, '0'), PAGE_W - MARGIN_X, y, 7.5 * 0.16, 'right');
};

const newPage = (ctx: Ctx, headerLabel?: string) => {
  drawFooter(ctx);
  ctx.pdf.addPage('letter', 'portrait');
  ctx.page += 1;
  if (headerLabel) ctx.headerLabel = headerLabel;
  drawHeader(ctx);
  ctx.y = BODY_TOP;
};

/** Ensure `needed` points of vertical room, adding a page if not. */
const ensure = (ctx: Ctx, needed: number, headerLabel?: string) => {
  if (ctx.y + needed > CONTENT_BOTTOM) newPage(ctx, headerLabel);
};

interface TextOpts {
  font?: string;
  style?: 'normal' | 'bold' | 'italic';
  size: number;
  lineHeight: number;
  color?: [number, number, number];
  x?: number;
  width?: number;
  gapAfter?: number;
}

const wrappedText = (ctx: Ctx, text: string, o: TextOpts) => {
  const { pdf } = ctx;
  const x = o.x ?? MARGIN_X;
  const width = o.width ?? CONTENT_W;
  pdf.setFont(o.font ?? SERIF, o.style ?? 'normal');
  pdf.setFontSize(o.size);
  setFill(pdf, o.color ?? INK);
  const lh = o.size * o.lineHeight;
  const lines: string[] = pdf.splitTextToSize(text, width);
  lines.forEach((line) => {
    ensure(ctx, lh);
    pdf.setFont(o.font ?? SERIF, o.style ?? 'normal');
    pdf.setFontSize(o.size);
    setFill(pdf, o.color ?? INK);
    ctx.y += lh;
    pdf.text(line, x, ctx.y);
  });
  ctx.y += o.gapAfter ?? 0;
};

const measureLines = (pdf: jsPDF, text: string, o: TextOpts) => {
  pdf.setFont(o.font ?? SERIF, o.style ?? 'normal');
  pdf.setFontSize(o.size);
  return (pdf.splitTextToSize(text, o.width ?? CONTENT_W) as string[]).length;
};

const sectionTitle = (ctx: Ctx, text: string) => {
  ensure(ctx, 22.8 * 1.2 + 24);
  wrappedText(ctx, text, { size: 22.8, style: 'bold', lineHeight: 1.1, gapAfter: 10 });
};

/* ------------------------------ table ------------------------------ */

const COL1_W = CONTENT_W * 0.28;
const COL2_X = MARGIN_X + CONTENT_W * 0.32;
const COL2_W = CONTENT_W * 0.68;

const drawTable = (ctx: Ctx, rows: Array<{ area: string; value: string }>) => {
  const { pdf } = ctx;
  const size = 13.8;
  const lh = size * 1.34;

  // header
  ensure(ctx, 40);
  pdf.setFont(SANS, 'normal');
  pdf.setFontSize(8.2);
  setFill(pdf, MUTED);
  ctx.y += 12;
  tracked(pdf, 'AREA', MARGIN_X, ctx.y, 8.2 * 0.19);
  tracked(pdf, 'DECISION', COL2_X, ctx.y, 8.2 * 0.19);
  ctx.y += 8;
  rule(ctx);

  rows.forEach((row) => {
    const leftLines = measureLines(pdf, row.area, { size, width: COL1_W, style: 'bold', lineHeight: 1.34 });
    const rightLines = measureLines(pdf, row.value, { size, width: COL2_W, lineHeight: 1.34 });
    const rowH = Math.max(leftLines, rightLines) * lh + 18;

    if (ctx.y + rowH > CONTENT_BOTTOM) {
      newPage(ctx);
      ctx.y += 4;
    }

    const top = ctx.y + 12;

    pdf.setFont(SERIF, 'bold');
    pdf.setFontSize(size);
    setFill(pdf, INK);
    (pdf.splitTextToSize(row.area, COL1_W) as string[]).forEach((line, i) => {
      pdf.text(line, MARGIN_X, top + (i + 1) * lh - lh * 0.25);
    });

    pdf.setFont(SERIF, 'normal');
    (pdf.splitTextToSize(row.value, COL2_W) as string[]).forEach((line, i) => {
      pdf.text(line, COL2_X, top + (i + 1) * lh - lh * 0.25);
    });

    ctx.y = top + Math.max(leftLines, rightLines) * lh + 6;
    rule(ctx, RULE_SOFT);
  });
};

/* -------------------------- detail sections ------------------------ */

const NUM_COL_W = 0.5 * IN;
const DETAIL_X = MARGIN_X + NUM_COL_W + 10;
const DETAIL_W = CONTENT_W - NUM_COL_W - 10;

const detailSection = (ctx: Ctx, index: number, title: string, items: string[]) => {
  const { pdf } = ctx;
  // keep heading with at least its first bullet
  const firstItemLines = items.length
    ? measureLines(pdf, items[0], { size: 12.6, width: DETAIL_W - 12, lineHeight: 1.33 })
    : 1;
  ensure(ctx, 18.2 * 1.2 + firstItemLines * 12.6 * 1.33 + 34, 'Meeting Notes / Detailed Notes');

  const headTop = ctx.y;

  pdf.setFont(SERIF, 'bold');
  pdf.setFontSize(18.2);
  setFill(pdf, INK);
  ctx.y += 18.2 * 1.1;
  pdf.text(title, DETAIL_X, ctx.y);

  // number column, aligned to heading baseline
  pdf.setFont(SANS, 'normal');
  pdf.setFontSize(8.2);
  setFill(pdf, MUTED);
  tracked(pdf, String(index).padStart(2, '0'), MARGIN_X, headTop + 18.2 * 1.1 - 4, 8.2 * 0.19);

  ctx.y += 8;

  items.forEach((item) => {
    const lines = measureLines(pdf, item, { size: 12.6, width: DETAIL_W - 12, lineHeight: 1.33 });
    ensure(ctx, lines * 12.6 * 1.33 + 6, 'Meeting Notes / Detailed Notes');
    const bulletY = ctx.y + 12.6 * 1.33 - 4;
    pdf.setFillColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.circle(DETAIL_X + 2, bulletY - 3, 1.1, 'F');
    wrappedText(ctx, item, {
      size: 12.6,
      lineHeight: 1.33,
      x: DETAIL_X + 12,
      width: DETAIL_W - 12,
      gapAfter: 5,
    });
  });

  ctx.y += 12;
  ensure(ctx, 10, 'Meeting Notes / Detailed Notes');
  rule(ctx, RULE_SOFT);
  ctx.y += 18;
};

/* ------------------------------ main -------------------------------- */

export const exportSummaryPdf = async ({
  session,
  summary,
  tasks,
  transcript,
}: ExportPdfInput) => {
  const title = clean(session?.title || '') || 'Recording';
  const dateLabel = formatDate(session?.started_at);
  const logo = await loadLogoPng();

  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });

  const ctx: Ctx = {
    pdf,
    y: BODY_TOP,
    page: 1,
    headerLabel: 'Meeting Notes / Session Summary',
    footerLeft: [title, dateLabel].filter(Boolean).join(' · '),
    logo,
  };

  drawHeader(ctx);

  /* ---------- page 1 ---------- */
  wrappedText(ctx, title, { size: 29, style: 'bold', lineHeight: 1.02, gapAfter: 18 });

  if (dateLabel) {
    wrappedText(ctx, dateLabel, { size: 14.1, lineHeight: 1.4, color: MUTED, gapAfter: 2 });
  }
  // "Source:" bold, value regular
  {
    ensure(ctx, 14.1 * 1.4);
    ctx.y += 14.1 * 1.4;
    pdf.setFont(SERIF, 'bold');
    pdf.setFontSize(14.1);
    setFill(pdf, INK);
    pdf.text('Source:', MARGIN_X, ctx.y);
    const w = pdf.getTextWidth('Source: ');
    pdf.setFont(SERIF, 'normal');
    setFill(pdf, MUTED);
    pdf.text('Voice recording', MARGIN_X + w, ctx.y);
  }

  ctx.y += 26;
  rule(ctx);
  ctx.y += 26;

  const overview = clean(summary?.overview);
  if (overview) {
    sectionTitle(ctx, 'Summary');
    wrappedText(ctx, overview, { size: 15.7, lineHeight: 1.46, gapAfter: 26 });
    rule(ctx);
    ctx.y += 26;
  }

  const decisions = listOf(summary?.decisions);
  const keyTopics = listOf(summary?.key_topics);
  const questions = listOf(summary?.questions);
  const risks = listOf(summary?.risks);
  const followups = listOf(summary?.followups);
  const participants = listOf(summary?.participants);
  const dates = listOf(summary?.dates);
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const taskLines = openTasks.map(
    (t) =>
      `${clean(t.title)}${t.owner ? ` — ${clean(t.owner)}` : ''}${
        t.due_at ? ` (due ${formatDate(t.due_at)})` : ''
      }`
  );

  const tableRows: Array<{ area: string; value: string }> = [];
  const push = (area: string, items: string[]) => {
    if (items.length) tableRows.push({ area, value: items.join('; ') });
  };
  push('Decisions', decisions);
  push('Action items', taskLines);
  push('Key topics', keyTopics);
  push('Participants', participants);
  push('Important dates', dates);

  if (tableRows.length) {
    sectionTitle(ctx, 'Key Decisions at a Glance');
    drawTable(ctx, tableRows);
  }

  /* ---------- detail pages ---------- */
  const detailSections: Array<{ title: string; items: string[] }> = [
    { title: 'Decisions', items: decisions },
    { title: 'Action Items', items: taskLines },
    { title: 'Key Topics', items: keyTopics },
    { title: 'Questions', items: questions },
    { title: 'Important Dates', items: dates },
    { title: 'Participants', items: participants },
    { title: 'Risks', items: risks },
    { title: 'Follow-ups', items: followups },
  ].filter((s) => s.items.length > 0);

  if (detailSections.length) {
    newPage(ctx, 'Meeting Notes / Detailed Notes');

    // Title row with right-side kicker
    const kicker = title.length > 44 ? `${title.slice(0, 41)}…` : title;
    pdf.setFont(SERIF, 'bold');
    pdf.setFontSize(22.8);
    setFill(pdf, INK);
    ctx.y += 22.8 * 1.1;
    pdf.text('Detailed Notes', MARGIN_X, ctx.y);
    pdf.setFont(SANS, 'normal');
    pdf.setFontSize(8.2);
    setFill(pdf, MUTED);
    tracked(pdf, kicker.toUpperCase(), PAGE_W - MARGIN_X, ctx.y - 3, 8.2 * 0.19, 'right');
    ctx.y += 14;
    rule(ctx);
    ctx.y += 22;

    detailSections.forEach((section, i) => {
      detailSection(ctx, i + 1, section.title, section.items);
    });
  }

  /* ---------- transcript ---------- */
  const transcriptText = (transcript || '').trim();
  if (transcriptText) {
    newPage(ctx, 'Meeting Notes / Transcript');

    pdf.setFont(SERIF, 'bold');
    pdf.setFontSize(22.8);
    setFill(pdf, INK);
    ctx.y += 22.8 * 1.1;
    pdf.text('Transcript', MARGIN_X, ctx.y);
    ctx.y += 14;
    rule(ctx);
    ctx.y += 22;

    const turns = parseSpeakerTurns(transcriptText);
    const colorMap = buildSpeakerColorMap(turns);

    turns.forEach((turn) => {
      const size = 12.6;
      const lh = size * 1.46;
      const paras = turn.text
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+\n/g, '\n').trim())
        .filter(Boolean);

      if (turn.speaker) {
        const chipH = 15;
        const firstLine = paras[0] ?? '';
        // keep the speaker chip with at least the first line of dialogue
        ensure(ctx, chipH + (firstLine ? lh : 0) + 6, 'Meeting Notes / Transcript');

        pdf.setFont(SANS, 'bold');
        pdf.setFontSize(9.4);
        const labelW = pdf.getTextWidth(turn.speaker);
        const padX = 5;
        const chipY = ctx.y + 2;
        const swatch = SPEAKER_PALETTE[colorMap.get(turn.speaker) ?? 0].rgb;
        pdf.setFillColor(swatch[0], swatch[1], swatch[2]);
        pdf.roundedRect(MARGIN_X, chipY, labelW + padX * 2, chipH, 3, 3, 'F');
        setFill(pdf, INK);
        pdf.text(turn.speaker, MARGIN_X + padX, chipY + chipH - 4.6);
        ctx.y = chipY + chipH + 5;
      }

      paras.forEach((para, i) => {
        wrappedText(ctx, para, {
          size,
          lineHeight: 1.46,
          gapAfter: i === paras.length - 1 ? (turn.speaker ? 15 : 12) : 8,
        });
      });
    });

  }

  drawFooter(ctx);

  const safeName = (clean(session?.title || '') || 'recording')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);

  pdf.save(`${safeName || 'recording'}.pdf`);
};
