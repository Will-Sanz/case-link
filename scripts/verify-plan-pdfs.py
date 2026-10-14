"""Verify synthetic PDF content, page geometry and monochrome rendering using Poppler."""
import collections
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
import xml.etree.ElementTree as ET


def normalized(value):
    value = re.sub(r"-\s*\n\s*", "", value)
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value)).strip()


def tokens(value):
    return collections.Counter(re.findall(r"[\w]+", normalized(value)))


def verify(case):
    path = Path(case["file"])
    xml_path = path.with_suffix(".html")
    subprocess.run([os.environ.get("PDFTOTEXT_BIN", "pdftotext"), "-bbox-layout", str(path), str(xml_path)], check=True)
    pages = ET.parse(xml_path).findall(".//{*}page")
    assert len(pages) >= case["minimumPages"], "Fixture did not exercise the intended page count"
    # Footer text must not interrupt a source word continuing on the next page.
    lines = [" ".join(word.text or "" for word in line.findall("{*}word"))
             for page in pages for line in page.findall(".//{*}line")
             if float(line.attrib["yMin"]) <= float(page.attrib["height"]) - 38]
    text = "\n".join(lines)
    compact = normalized(text)
    counts = tokens(text)
    errors = []
    for expected in case["requiredText"]:
        # Text may continue on another page or beside a date/status column. Check its full token inventory too.
        if normalized(expected) not in compact and tokens(expected) - counts:
            errors.append("Missing source text: " + expected[:90])
    if tokens("\n".join(case["requiredText"])) - counts:
        errors.append("Source text inventory is incomplete (including repeated fields)")
    for forbidden in case["forbiddenText"]:
        if forbidden in compact:
            errors.append("Unexpected text: " + forbidden)
    page_texts = [normalized("\n".join(" ".join(word.text or "" for word in line.findall("{*}word"))
                                     for line in page.findall(".//{*}line"))) for page in pages]
    for action in case["actionHeaders"]:
        if not any(normalized(action["title"]) in page_text and action["date"] in page_text and action["status"] in page_text
                   for page_text in page_texts):
            errors.append("Action title separated from its date/status: " + action["title"][:90])
    for index, page in enumerate(pages):
        width, height = float(page.attrib["width"]), float(page.attrib["height"])
        words = page.findall(".//{*}word")
        page_text = normalized("\n".join(" ".join(word.text or "" for word in line.findall("{*}word")) for line in page.findall(".//{*}line")))
        for goal in case["goalStarts"]:
            if normalized(goal["title"]) in page_text and normalized(goal["followingText"]) not in page_text:
                errors.append(f"Page {index + 1}: goal heading separated from its first task")
        footer = [word for word in words if float(word.attrib["yMin"]) > height - 38]
        footer_text = " ".join(word.text or "" for word in footer)
        if f"Page {index + 1} of {len(pages)}" not in footer_text:
            errors.append(f"Page {index + 1}: incorrect footer")
        body = [word for word in words if word not in footer]
        if not body:
            errors.append(f"Page {index + 1}: empty body")
        body_lines = [line for line in page.findall(".//{*}line") if float(line.attrib["yMin"]) <= height - 38]
        if body_lines and normalized(" ".join(word.text or "" for word in body_lines[-1].findall("{*}word"))) in {"Contacts", "Documents or materials", "Expected outcome"}:
            errors.append(f"Page {index + 1}: field heading separated from its content")
        for word in body:
            x1, y1, x2, y2 = (float(word.attrib[key]) for key in ("xMin", "yMin", "xMax", "yMax"))
            if x1 < 36 or x2 > width - 36 or y1 < 36 or y2 > height - 44:
                errors.append(f"Page {index + 1}: text outside print margins: {word.text}")
        for left_index, left in enumerate(body):
            for right in body[left_index + 1:]:
                overlap_x = min(float(left.attrib["xMax"]), float(right.attrib["xMax"])) - max(float(left.attrib["xMin"]), float(right.attrib["xMin"]))
                overlap_y = min(float(left.attrib["yMax"]), float(right.attrib["yMax"])) - max(float(left.attrib["yMin"]), float(right.attrib["yMin"]))
                if overlap_x > 1 and overlap_y > 1:
                    errors.append(f"Page {index + 1}: overlapping text: {left.text} / {right.text}")
    prefix = str(path.with_suffix(""))
    subprocess.run([os.environ.get("PDFTOPPM_BIN", "pdftoppm"), "-r", "60", str(path), prefix], check=True)
    for ppm in path.parent.glob(path.stem + "-*.ppm"):
        with ppm.open("rb") as file:
            assert file.readline().strip() == b"P6", "Expected RGB raster"
            dimensions = file.readline()
            while dimensions.startswith(b"#"):
                dimensions = file.readline()
            image_width, image_height = map(int, dimensions.split())
            assert file.readline().strip() == b"255", "Expected 8-bit color"
            pixels = file.read()
            assert len(pixels) == image_width * image_height * 3
            if not pixels[::3] == pixels[1::3] == pixels[2::3]:
                errors.append("Rendered page contains color")
        ppm.unlink()
    if os.environ.get("CASELINK_PDF_RENDER_PNG") == "1":
        for old_page in path.parent.glob(path.stem + "-*.png"):
            if re.fullmatch(re.escape(path.stem) + r"-\d+\.png", old_page.name):
                old_page.unlink()
        subprocess.run([os.environ.get("PDFTOPPM_BIN", "pdftoppm"), "-scale-to", "1400", "-png", str(path), prefix], check=True)
    return {"fixture": case["name"], "pages": len(pages), "checkedSourceFields": len(case["requiredText"]), "errors": errors[:20], "passed": not errors}


if __name__ == "__main__":
    manifest = Path(sys.argv[1])
    try:
        results = [verify(case) for case in json.loads(manifest.read_text())]
    except FileNotFoundError as error:
        raise SystemExit("PDF checks require Python 3 and Poppler (pdftotext and pdftoppm); set PDFTOTEXT_BIN / PDFTOPPM_BIN if needed.") from error
    report = {"syntheticOnly": True, "results": results}
    manifest.with_name("verification.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    sys.exit(0 if all(result["passed"] for result in results) else 1)
