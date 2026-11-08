"""Synthetic PDF text fidelity, bounds and rendering; no household data or network."""
import json
from pathlib import Path
import sys
import pypdfium2 as pdfium

directory = Path(sys.argv[1])
for case in json.loads((directory / "manifest.json").read_text()):
    document = pdfium.PdfDocument(directory / f"{case['name']}.pdf")
    assert len(document) >= case["minimumPages"], "Pagination fixture did not span the intended pages"
    text = " ".join(" ".join(page.get_textpage().get_text_range().split()) for page in document)
    for value in case["required"]:
        assert " ".join(value.split()) in text, f"Missing exact source text: {value}"
    for index, page in enumerate(document):
        text_page = page.get_textpage()
        width, height = page.get_size()
        for char in range(text_page.count_chars()):
            left, bottom, right, top = text_page.get_charbox(char)
            assert left >= 0 and bottom >= 0 and right <= width and top <= height, "Text clipped outside page"
        page.render(scale=1.3).to_pil().save(directory / f"{case['name']}-{index + 1}.png")
    print(f"Verified {case['name']}: {len(document)} page(s), source text, bounds and render.")
