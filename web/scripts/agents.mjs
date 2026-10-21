import fs from "node:fs";
const source = new URL("../../agents/sworn/SKILL.md", import.meta.url);
const text = fs.readFileSync(source, "utf8");
fs.mkdirSync(new URL("../public/agents/sworn/", import.meta.url), {
  recursive: true,
});
fs.writeFileSync(
  new URL("../public/agents/sworn/SKILL.md", import.meta.url),
  text,
);
// The legacy URL remains a complete plain Markdown skill.
fs.writeFileSync(
  new URL("../public/agents/sworn.md", import.meta.url),
  text.replaceAll("(../../", "(../"),
);
fs.copyFileSync(
  new URL("../../llms.txt", import.meta.url),
  new URL("../public/llms.txt", import.meta.url),
);
