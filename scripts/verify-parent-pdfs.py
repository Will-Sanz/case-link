"""Synthetic PDF text fidelity, bounds and rendering; no household data or network."""
import json
from pathlib import Path
import sys
import pypdfium2 as pdfium
from PIL import ImageChops

directory = Path(sys.argv[1])
for case in json.loads((directory / "manifest.json").read_text()):
    document = pdfium.PdfDocument(directory / f"{case['name']}.pdf")
    assert len(document) >= case["minimumPages"], "Pagination fixture did not span the intended pages"
    text = " ".join(" ".join(page.get_textpage().get_text_range().split()) for page in document)
    assert "\ufffd" not in text and "\u25a0" not in text, "Missing printable glyph"
    for value in case["required"]:
        assert " ".join(value.split()) in text, f"Missing exact source text: {value}"
    for related in case.get("samePageText", []):
        assert any(all(" ".join(value.split()) in " ".join(page.get_textpage().get_text_range().split()) for value in related) for page in document), "Related report and limitation separated across pages"
    for index, page in enumerate(document):
        text_page = page.get_textpage()
        page_text = " ".join(text_page.get_text_range().split())
        if case["name"] != "known-form-render":
            label = f"Página {index + 1} de {len(document)}" if case.get("locale") == "es" else f"Page {index + 1} of {len(document)}"
            assert label in page_text, "Missing or incorrect localized page number"
        width, height = page.get_size()
        for char in range(text_page.count_chars()):
            left, bottom, right, top = text_page.get_charbox(char)
            assert left >= 0 and bottom >= 0 and right <= width and top <= height, "Text clipped outside page"
        image = page.render(scale=1.3).to_pil().convert("RGB")
        red, green, blue = image.split()
        assert ImageChops.difference(red, green).getbbox() is None and ImageChops.difference(red, blue).getbbox() is None, "Printable helper is not monochrome"
        image.save(directory / f"{case['name']}-{index + 1}.png")
    print(f"Verified {case['name']}: {len(document)} page(s), source text, bounds and render.")
