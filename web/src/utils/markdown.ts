/**
 * Model-generated transcripts and summaries frequently come back with
 * Markdown emphasis in them (`**Speaker 1:**`, `**Meeting Notes**`). Nothing
 * in the app renders Markdown, so those markers would otherwise show up as
 * literal asterisks on screen and in the PDF export. Strip them everywhere
 * text is displayed.
 */

/** Remove Markdown emphasis, inline code and heading markers from a string. */
export const stripMarkdown = (value: unknown): string => {
  if (typeof value !== 'string') return '';

  return value
    // Inline code: `code` / ```code```
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    // ATX headings: "## Title"
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    // Bold + italic, then bold, then italic. Underscores only in their
    // doubled form, so identifiers like snake_case_name survive.
    .replace(/\*\*\*(\S(?:[\s\S]*?\S)?)\*\*\*/g, '$1')
    .replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, '$1')
    .replace(/__(\S(?:[\s\S]*?\S)?)__/g, '$1')
    .replace(/\*(\S(?:[\s\S]*?\S)?)\*/g, '$1')
    // Unbalanced leftovers (e.g. "**Speaker 1:** text" once the label is split
    // off leaves a dangling "**").
    .replace(/\*{2,}/g, '')
    .replace(/_{2,}/g, '');
};

/** Strip Markdown and collapse all runs of whitespace onto a single space. */
export const stripMarkdownInline = (value: unknown): string =>
  stripMarkdown(value).replace(/\s+/g, ' ').trim();
