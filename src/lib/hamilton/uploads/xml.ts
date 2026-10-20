import { Parser } from "htmlparser2";
import { invalidFile, workbookLimit } from "./limits";

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const localName = (name: string) => name.slice(name.lastIndexOf(":") + 1);

function checkEntities(text: string): void {
  for (let cursor = text.indexOf("&"); cursor >= 0; cursor = text.indexOf("&", cursor)) {
    const end = text.indexOf(";", cursor + 1);
    if (end < 0) invalidFile();
    const entity = text.slice(cursor + 1, end);
    if (!["amp", "lt", "gt", "quot", "apos"].includes(entity)) {
      if (!/^#(?:\d+|x[\da-fA-F]+)$/.test(entity)) invalidFile();
      const point = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!(point === 9 || point === 10 || point === 13 || (point >= 32 && point <= 0xd7ff) ||
          (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff))) invalidFile();
    }
    cursor = end + 1;
  }
}

function checkAttributes(content: string, start: number): void {
  const end = content.endsWith("/") ? content.length - 1 : content.length;
  const attribute = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
  let cursor = start;
  let count = 0;
  while (cursor < end) {
    if (!/\s/.test(content[cursor])) invalidFile();
    while (cursor < end && /\s/.test(content[cursor])) cursor++;
    if (cursor === end) break;
    attribute.lastIndex = cursor;
    const match = attribute.exec(content);
    if (!match || attribute.lastIndex > end) invalidFile();
    if (++count > 64) workbookLimit("an XML element can have up to 64 attributes.");
    checkEntities(match[2] ?? match[3]);
    cursor = attribute.lastIndex;
  }
}

/** htmlparser2 tolerates missing/mismatched closing tags. Check structure first. */
function checkStructure(xml: string): void {
  const stack: string[] = [];
  let rootSeen = false;
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    const textEnd = start < 0 ? xml.length : start;
    checkEntities(xml.slice(cursor, textEnd));
    if (stack.length === 0 && xml.slice(cursor, textEnd).trim()) invalidFile();
    if (start < 0) break;
    if (xml.startsWith("<!--", start)) {
      const end = xml.indexOf("-->", start + 4);
      if (end < 0 || xml.slice(start + 4, end).includes("--")) invalidFile();
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", start)) {
      const end = xml.indexOf("]]>", start + 9);
      if (end < 0 || stack.length === 0) invalidFile();
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?xml ", start)) {
      const end = xml.indexOf("?>", start + 6);
      if (end < 0 || rootSeen || start !== 0) invalidFile();
      cursor = end + 2;
      continue;
    }
    if (xml[start + 1] === "!" || xml[start + 1] === "?") invalidFile();
    let end = start + 1;
    let quote = "";
    for (; end < xml.length; end++) {
      const character = xml[end];
      if (quote) { if (character === quote) quote = ""; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
      else if (character === "<") invalidFile();
    }
    if (end === xml.length || quote) invalidFile();
    const closing = xml[start + 1] === "/";
    const content = xml.slice(start + (closing ? 2 : 1), end);
    const name = XML_NAME.exec(content)?.[0];
    if (!name) invalidFile();
    if (closing) {
      if (content.slice(name.length).trim() || stack.pop() !== name) invalidFile();
    } else {
      checkAttributes(content, name.length);
      if (stack.length === 0) { if (rootSeen) invalidFile(); rootSeen = true; }
      if (stack.length >= 64) workbookLimit("up to 64 nested XML elements are accepted.");
      if (!content.endsWith("/")) stack.push(name);
    }
    cursor = end + 1;
  }
  if (!rootSeen || stack.length) invalidFile();
}

export function readXml(xml: string, expectedRoot: string, handlers: {
  open: (name: string, attrs: Record<string, string>, parent: string | undefined) => void;
  text: (text: string, path: readonly string[]) => void;
  close: (name: string) => void;
}): void {
  xml = xml.replace(/^\uFEFF/, "");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) invalidFile();
  checkStructure(xml);
  const path: string[] = [];
  let attributes = new Set<string>();
  const parser = new Parser({
    onopentagname() { attributes = new Set(); },
    onattribute(name, _value, quote) {
      if (quote !== '"' && quote !== "'") invalidFile();
      if (attributes.has(name)) invalidFile();
      attributes.add(name);
      if (attributes.size > 64) workbookLimit("an XML element can have up to 64 attributes.");
    },
    onopentag(name, attrs) {
      name = localName(name);
      if (path.length === 0 && name !== expectedRoot) invalidFile();
      handlers.open(name, attrs, path.at(-1));
      path.push(name);
    },
    ontext(text) { handlers.text(text, path); },
    onclosetag(name) { handlers.close(localName(name)); path.pop(); },
  }, { xmlMode: true, decodeEntities: true });
  parser.end(xml);
}
