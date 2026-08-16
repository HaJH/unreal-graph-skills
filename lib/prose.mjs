// The smallest markdown a build guide needs: paragraphs, bullets, bold, inline code, links.
//
// Deliberately not a markdown library. A guide's prose sits between the diagrams rather than
// carrying the page, and a spec that needs more than this is better off stating HTML outright --
// which it can, since a `body` starting with `<` is passed through untouched.
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const inline = (s) => escape(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');

export const renderProse = (body) => {
  const text = String(body).trim();
  if (text.startsWith("<")) return `${text}\n`;

  return text.split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => l.startsWith("- "))) {
      const items = lines.map((l) => `      <li>${inline(l.slice(2))}</li>`).join("\n");
      return `    <ul class="prose-list">\n${items}\n    </ul>`;
    }
    return `    <p class="sub wide">${inline(lines.join(" "))}</p>`;
  }).join("\n") + "\n";
};
