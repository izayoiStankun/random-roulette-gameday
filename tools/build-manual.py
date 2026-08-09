from __future__ import annotations

import html
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.2.0"
SOURCE = ROOT / "docs" / f"랜덤룰렛게임데이-사용설명서-v{VERSION}.md"
BUILD = ROOT / "docs" / "build"
HTML_OUT = BUILD / f"랜덤룰렛게임데이-사용설명서-v{VERSION}.html"
DOCX_OUT = BUILD / f"랜덤룰렛게임데이-사용설명서-v{VERSION}.docx"


def inline_markup(text: str) -> str:
    value = html.escape(text)
    value = re.sub(r"`([^`]+)`", r"<code>\1</code>", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", value)
    value = re.sub(r"(https?://[^\s<]+)", r'<a href="\1">\1</a>', value)
    return value


def markdown_to_html(markdown: str) -> str:
    parts: list[str] = []
    in_list: str | None = None
    paragraph: list[str] = []

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            parts.append(f"<p>{'<br>'.join(inline_markup(line) for line in paragraph)}</p>")
            paragraph = []

    def close_list() -> None:
        nonlocal in_list
        if in_list:
            parts.append(f"</{in_list}>")
            in_list = None

    for raw in markdown.splitlines():
        line = raw.rstrip()
        if line == "<!-- pagebreak -->":
            flush_paragraph()
            close_list()
            parts.append('<div class="pagebreak"></div>')
            continue
        if not line:
            flush_paragraph()
            close_list()
            continue
        heading = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading:
            flush_paragraph()
            close_list()
            level = len(heading.group(1))
            parts.append(f"<h{level}>{inline_markup(heading.group(2))}</h{level}>")
            continue
        if line.startswith("> "):
            flush_paragraph()
            close_list()
            parts.append(f"<aside>{inline_markup(line[2:])}</aside>")
            continue
        bullet = re.match(r"^-\s+(.+)$", line)
        ordered = re.match(r"^\d+\.\s+(.+)$", line)
        if bullet or ordered:
            flush_paragraph()
            kind = "ul" if bullet else "ol"
            if in_list != kind:
                close_list()
                parts.append(f"<{kind}>")
                in_list = kind
            parts.append(f"<li>{inline_markup((bullet or ordered).group(1))}</li>")
            continue
        if line == "---":
            flush_paragraph()
            close_list()
            parts.append("<hr>")
            continue
        paragraph.append(line.rstrip("  "))

    flush_paragraph()
    close_list()
    body = "\n".join(parts)
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>랜덤룰렛게임데이 사용설명서</title>
<style>
@page {{ size: A4; margin: 16mm 17mm 18mm; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; color: #17212b; font: 10.3pt/1.62 "Malgun Gothic", "Noto Sans KR", sans-serif; word-break: keep-all; }}
h1 {{ margin: 52mm 0 5mm; color: #07131c; font-size: 30pt; letter-spacing: -1.5px; }}
h1::before {{ content: "BROADCAST CONTROL"; display: block; margin-bottom: 8mm; color: #00a98f; font: bold 9pt/1 monospace; letter-spacing: 2px; }}
h2 {{ margin: 10mm 0 4mm; padding-bottom: 2.5mm; border-bottom: 2px solid #00c9aa; color: #0b2732; font-size: 18pt; page-break-after: avoid; }}
h1 + h2 {{ margin-top: 0; border: 0; color: #00a98f; font-size: 17pt; }}
h3 {{ margin: 6mm 0 2mm; color: #0c5260; font-size: 12.5pt; page-break-after: avoid; }}
p {{ margin: 0 0 3.2mm; }}
ul, ol {{ margin: 1mm 0 4mm; padding-left: 7mm; }}
li {{ margin: 0 0 1.4mm; }}
aside {{ margin: 5mm 0; padding: 4mm 5mm; border-left: 4px solid #00c9aa; border-radius: 2mm; background: #edf9f7; color: #21434b; }}
code {{ padding: 0.4mm 1mm; border-radius: 1mm; background: #eaf0f4; color: #0c5260; font-family: Consolas, monospace; }}
a {{ color: #007e6c; text-decoration: none; }}
hr {{ margin: 9mm 0 4mm; border: 0; border-top: 1px solid #bdd0d6; }}
.pagebreak {{ page-break-before: always; }}
body::after {{ content: "랜덤룰렛게임데이 · v{VERSION}"; position: fixed; right: 0; bottom: -10mm; color: #71838b; font-size: 8pt; }}
</style></head><body>{body}</body></html>"""


def xml_text(text: str, bold: bool = False, color: str | None = None, size: int | None = None) -> str:
    props = []
    if bold:
        props.append("<w:b/>")
    if color:
        props.append(f'<w:color w:val="{color}"/>')
    if size:
        props.append(f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>')
    prop_xml = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    return f'<w:r>{prop_xml}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def paragraph_xml(text: str, style: str | None = None, indent: int = 0, shade: str | None = None) -> str:
    p_props = []
    if style:
        p_props.append(f'<w:pStyle w:val="{style}"/>')
    if indent:
        p_props.append(f'<w:ind w:left="{indent}"/>')
    if shade:
        p_props.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>')
    runs: list[str] = []
    cursor = 0
    for match in re.finditer(r"`([^`]+)`|\*\*([^*]+)\*\*", text):
        if match.start() > cursor:
            runs.append(xml_text(text[cursor:match.start()]))
        if match.group(1) is not None:
            runs.append(xml_text(match.group(1), color="0C5260"))
        else:
            runs.append(xml_text(match.group(2), bold=True))
        cursor = match.end()
    if cursor < len(text):
        runs.append(xml_text(text[cursor:]))
    return f"<w:p><w:pPr>{''.join(p_props)}</w:pPr>{''.join(runs)}</w:p>"


def markdown_to_doc_xml(markdown: str) -> str:
    body: list[str] = []
    pending: list[str] = []

    def flush() -> None:
        nonlocal pending
        if pending:
            body.append(paragraph_xml(" ".join(pending)))
            pending = []

    for raw in markdown.splitlines():
        line = raw.rstrip()
        if line == "<!-- pagebreak -->":
            flush()
            body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
            continue
        if not line:
            flush()
            continue
        heading = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading:
            flush()
            level = len(heading.group(1))
            body.append(paragraph_xml(heading.group(2), f"Heading{level}"))
            continue
        if line.startswith("> "):
            flush()
            body.append(paragraph_xml(line[2:], indent=360, shade="EDF9F7"))
            continue
        bullet = re.match(r"^-\s+(.+)$", line)
        ordered = re.match(r"^(\d+)\.\s+(.+)$", line)
        if bullet:
            flush()
            body.append(paragraph_xml(f"• {bullet.group(1)}", indent=360))
            continue
        if ordered:
            flush()
            body.append(paragraph_xml(f"{ordered.group(1)}. {ordered.group(2)}", indent=360))
            continue
        if line == "---":
            flush()
            body.append(paragraph_xml("―" * 32))
            continue
        pending.append(line.rstrip("  "))
    flush()
    section = ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
               '<w:pgMar w:top="907" w:right="964" w:bottom="1020" w:left="964"/>'
               '<w:cols w:space="425"/><w:docGrid w:linePitch="360"/></w:sectPr>')
    return "".join(body) + section


def build_docx(markdown: str) -> None:
    document = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{markdown_to_doc_xml(markdown)}</w:body></w:document>'''
    styles = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:eastAsia="Malgun Gothic" w:hAnsi="Malgun Gothic"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="480" w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="07131C"/><w:sz w:val="54"/><w:szCs w:val="54"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="180"/><w:pBdr><w:bottom w:val="single" w:sz="12" w:color="00C9AA"/></w:pBdr></w:pPr><w:rPr><w:b/><w:color w:val="0B2732"/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="0C5260"/><w:sz w:val="25"/><w:szCs w:val="25"/></w:rPr></w:style>
</w:styles>'''
    content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'''
    root_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'''
    doc_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'''
    with zipfile.ZipFile(DOCX_OUT, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", styles)
        archive.writestr("word/_rels/document.xml.rels", doc_rels)


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    markdown = SOURCE.read_text(encoding="utf-8")
    HTML_OUT.write_text(markdown_to_html(markdown), encoding="utf-8")
    build_docx(markdown)
    print(HTML_OUT)
    print(DOCX_OUT)


if __name__ == "__main__":
    main()
