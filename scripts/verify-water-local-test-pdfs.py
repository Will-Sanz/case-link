"""Native layout checks of invented local-test values; no City form, account or provider access."""
import hashlib
import json
import re
from pathlib import Path
import sys
import unicodedata
import pypdfium2 as pdfium
from pypdf import PdfReader

folder = Path(sys.argv[1])
record = json.loads((folder / "cases.json").read_text())
source = Path("tests/fixtures/parent/water-local-test-issued-2026-11-13.pdf").read_bytes()
assert hashlib.sha256(source).hexdigest() == record["source"]["sha256"]
assert len(source) == record["source"]["byteLength"] == 1300
assert record["source"]["kind"] == "local_test_issued_form"
assert record["source"]["id"] == "caselink-local-water-issued-form"
def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", value).split())
def region(textpage, bounds):
    left, bottom, right, top = bounds
    found = []
    for index in range(textpage.count_chars()):
        l, b, r, t = textpage.get_charbox(index)
        if left <= (l + r) / 2 <= right and bottom <= (b + t) / 2 <= top:
            found.append(textpage.get_text_range(index, 1))
    return normalize("".join(found))

total = 0
header_digest = None
for case in record["cases"]:
    path = folder / f"{case['name']}.pdf"
    reader = PdfReader(path)
    assert "/AcroForm" not in reader.trailer["/Root"] and "/EmbeddedFiles" not in reader.trailer["/Root"].get("/Names", {})
    doc = pdfium.PdfDocument(path)
    full = []
    for index in range(len(doc)):
        page = doc[index]
        textpage = page.get_textpage()
        try:
            text = normalize(textpage.get_text_range())
            assert text.count("LOCAL TEST WATER") == 1
            assert "Not a City of Philadelphia form. No provider action has occurred." in text
            assert "Private preparation test only - not signed or sent." in text
            for char in range(textpage.count_chars()):
                l, b, r, t = textpage.get_charbox(char)
                assert 0 <= l <= r <= 612 and 0 <= b <= t <= 792, "Local-test text clipped outside page"
            if index == 0:
                assert region(textpage, (36, 568, 576, 582)) == "Protected access code - local test only: " + case["values"]["access"]["accessCode"]
                assert region(textpage, (36, 548, 576, 562)) == "Protected access ZIP: " + case["values"]["access"]["zip"]
                if "recovery" in case["values"]:
                    assert region(textpage, (36, 528, 576, 542)) == "Supplied application ID - agency/account match unverified: " + case["values"]["recovery"]["applicationId"]
            full.append(text)
        finally:
            textpage.close()
        bitmap = page.render(scale=1.6)
        try:
            rendered = bitmap.to_pil()
            current_header = hashlib.sha256(rendered.crop((0, 0, rendered.width, 166)).tobytes()).hexdigest()
            if header_digest is None:
                header_digest = current_header
            assert current_header == header_digest, "LOCAL TEST header became clipped or changed on a later page"
            rendered.save(folder / f"{case['name']}-{index + 1}.png")
        finally:
            bitmap.close()
            page.close()
        total += 1
    text = " ".join(full)
    fields = case["fields"]
    for person in [fields["applicant"], *fields["householdMembers"]]:
        assert len(re.findall(re.escape(person["name"]) + r"(?!\w)", text)) == 1, "A household row was lost or duplicated across pages"
    assert "Personal signatures / financial assent: Not recorded" in text
    assert "Actual issued City form / provider acceptance / submission: Unverified; no action occurred" in text
    assert "Reference-only amount: 0.00 from the other-member under-18 SAMPLE instruction; actual form unverified" in text
    if case["name"] == "local-water-basic":
        assert "Reported monthly gross USD: Not provided" in text
        assert "Reported income inventory: Not provided" in text, "Unknown minor income was invented"
        for value in fields["livingExpenses"].values():
            assert value in text
    if case["name"] == "local-water-saved":
        assert "Reported monthly gross USD: 7.29" in text, "Actual minor income was replaced by the reference instruction"
        assert "Reported monthly gross USD: 2500.29" in text and "Support amount USD: 0.29" in text
        assert "Support frequency: other" in text and "Every three months" in text
    doc.close()
print(f"Verified {total} CaseLink LOCAL TEST WATER pages; invented protected values only, no City form, signature or provider action.")
