"""Independent fictional PGW source/field/blank-protected-region checks. No network."""
import hashlib
import json
from pathlib import Path
import sys
import unicodedata
import pypdfium2 as pdfium
from pypdf import PdfReader

folder = Path(sys.argv[1])
record = json.loads((folder / "cases.json").read_text())
source_path = Path("tests/fixtures/parent/pgw-crp-2026-11-13.pdf")
source = pdfium.PdfDocument(source_path)
digest = lambda data: hashlib.sha256(data).hexdigest()
assert digest(source_path.read_bytes()) == record["source"]["sourceSha256"]
assert len(source_path.read_bytes()) == record["source"]["sourceByteLength"]
assert len(source) == 4

def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", value).split())

def box_text(page, bounds):
    left, bottom, right, top = bounds
    text = page.get_textpage()
    found = []
    for index in range(text.count_chars()):
        l, b, r, t = text.get_charbox(index)
        if left <= (l + r) / 2 <= right and bottom <= (b + t) / 2 <= top:
            found.append(text.get_text_range(index, 1))
    return normalize("".join(found))

def region(page, bounds):
    l, b, r, t = bounds
    return box_text(page, (l * .94 + 18.36, b * .94 + 32, r * .94 + 18.36, t * .94 + 32))

total = 0
for case in record["cases"]:
    path = folder / f"{case['name']}.pdf"
    doc = pdfium.PdfDocument(path)
    reader = PdfReader(path)
    fields, manifest = case["fields"], case["manifest"]
    assert len(doc) == case["pages"] == manifest["pageCount"]
    assert "/AcroForm" not in reader.trailer["/Root"]
    assert manifest["artifactSha256"] == digest(path.read_bytes())
    assert manifest["sourceSha256"] == digest(source_path.read_bytes())
    assert manifest["formInputSha256"] == digest(json.dumps(fields, ensure_ascii=False, separators=(",", ":")).encode("utf-8")), "Printed fields lost their exact input digest"
    assert manifest["sourceContractId"] == record["source"]["id"] and manifest["sourceVerifiedUntil"] == record["source"]["verifiedUntil"]
    identifiers = {item["subjectId"]: item["identifier"] for item in case.get("identifiers", [])}
    assert manifest["requiredIdentifiersInserted"] is bool(identifiers) and manifest["signed"] is False
    assert manifest["financialAssentRecorded"] is False and manifest["submissionReady"] is False
    assert case["incomeProof"] == "not_assessed" and case["financialAssent"] == "not_recorded" and case["submissionReady"] is False
    customer = fields["customer"]
    people = [customer, *fields["householdMembers"]]
    assert manifest["subjectIds"] == [person["id"] for person in people]
    assert manifest["requiredIdentifierSubjects"] == [person["id"] for person in fields["householdMembers"]]
    assert all(item["state"] == "protected_entry_unresolved" and item["sourceId"] is None for item in case["protectedRequirements"])
    form, extra = doc[2], doc[3]
    assert region(form, (70, 457, 299, 473)) == f"{customer['firstName']} {customer['lastName']}"
    assert region(form, (408, 457, 593, 473)) == fields["accountNumber"]
    assert region(form, (61, 419, 298, 436)) == fields["address"]["street"]
    assert region(form, (326, 419, 478, 436)) == fields["address"]["city"]
    assert region(form, (512, 419, 593, 436)) == fields["address"]["state"]
    assert region(form, (40, 382, 299, 399)) == fields["address"]["zip"]
    assert region(form, (338, 382, 593, 399)) == fields["phone"]
    if not identifiers:
        assert not region(form, (343, 77, 477, 262)), "Required member identifiers were filled by the ordinary renderer"
    assert not region(form, (343, 240, 477, 262)), "Optional customer identifier was supplied"
    assert not region(form, (477, 240, 548, 262)), "Optional customer birth date was invented"
    for index, person in enumerate(people[:8]):
        bottom = 239.56 - index * (209 / 9)
        assert region(form, (20, bottom, 138, bottom + 23)) == person["lastName"]
        assert region(form, (140, bottom, 258, bottom + 23)) == person["firstName"]
        if index:
            assert region(form, (260, bottom, 342, bottom + 23)) == person["relationship"]
            birth = person["dateOfBirth"]
            assert region(form, (477, bottom, 548, bottom + 23)) == f"{birth[5:7]}/{birth[8:]}/{birth[:4]}"
            if identifiers:
                identifier = identifiers[person["id"]]
                assert region(form, (346, bottom, 386, bottom + 23)) == str(record["source"]["identifierTypes"].index(identifier["type"]) + 1)
                assert region(form, (389, bottom, 474, bottom + 23)) == identifier["value"], "Protected identifier was changed, clipped or placed on another person"
        assert region(form, (552, bottom, 593, bottom + 23)) in ("Y", "N")
    for index, person in enumerate(people[8:]):
        page = doc[4 + index // 20]
        bottom = 680 - (index % 20) * 29
        assert box_text(page, (36, bottom, 176, bottom + 21)) == person["lastName"]
        assert box_text(page, (179, bottom, 319, bottom + 21)) == person["firstName"]
        if identifiers:
            identifier = identifiers[person["id"]]
            expected = f'{record["source"]["identifierTypes"].index(identifier["type"]) + 1}: {identifier["value"]}'
            assert box_text(page, (415, bottom, 489, bottom + 21)) == expected, "Overflow identifier was changed or clipped"
        else:
            assert not box_text(page, (415, bottom, 489, bottom + 21)), "Overflow identifier was invented"
    if identifiers:
        all_text = normalize(" ".join(page.get_textpage().get_text_range() for page in doc))
        for identifier in identifiers.values():
            if identifier["type"] == "other":
                assert identifier["otherType"] in all_text and "Other identifier descriptions - preparation only" in all_text
    for bounds in [(18, 36, 218, 59), (245, 36, 445, 59), (470, 36, 594, 59), (18, 510, 197, 536)]:
        assert not region(extra, bounds), "A signature/date/print-name personal act was supplied"
    for key, y in [("snap", 134), ("housingSubsidy", 107)]:
        assert region(extra, (19, y + 1, 29, y + 12)) == ("X" if fields[key]["receives"] else "")
        if fields[key]["receives"]:
            cents = fields[key]["monthlyAmountCents"]
            assert region(extra, (472, y + 1, 593, y + 15)) == f"{cents // 100}.{cents % 100:02}"
    if fields.get("zeroIncomePast30Days"):
        for key, left in [("food", 23), ("housing", 215), ("utilities", 407)]:
            assert region(extra, (left, 248, left + 184, 364)) == fields["livingExpenses"][key]
        all_text = normalize(" ".join(page.get_textpage().get_text_range() for page in doc))
        assert customer["income"]["noIncomeSituation"] in all_text
        assert "not a personal certification" in all_text
    if fields["outsideSupport"]["receives"]:
        supporter = fields["outsideSupport"]["supporter"]
        assert region(extra, (189, 620, 426, 636)) == f"{supporter['firstName']} {supporter['lastName']}"
        assert region(extra, (463, 620, 593, 636)) == supporter["phone"]
        assert region(extra, (61, 583, 593, 599)) == supporter["address"]["street"]
        assert region(extra, (318, 509, 444, 525)) == "123.45"
    assert not box_text(doc[1], (18, 32, 594, 777)), "Blank physical second source page was removed or repurposed"
    links = sum(len(page.get("/Annots", [])) for page in reader.pages)
    assert links == 1
    for index, page in enumerate(doc):
        total += 1
        assert page.get_size() == (612, 792)
        text = normalize(page.get_textpage().get_text_range())
        assert text.count("UNSIGNED PGW PREPARATION DRAFT - NOT SENT") == 1
        footer = box_text(page, (0, 0, 612, 30))
        assert fields["accountNumber"] in footer and customer["lastName"] in footer
        assert f"Page {index + 1} of {len(doc)}" in footer
        if index < 4:
            for line in source[index].get_textpage().get_text_range().splitlines():
                if normalize(line): assert normalize(line) in text, "Source instructions/responsibilities changed"
        text_page = page.get_textpage()
        for character in range(text_page.count_chars()):
            l, b, r, t = text_page.get_charbox(character)
            assert 0 <= l <= r <= 612 and 0 <= b <= t <= 792, "Text clipped outside page"
        page.render(scale=1.6).to_pil().save(folder / f"{case['name']}-{index + 1}.png")
        page.render(scale=200 / 72).to_pil().convert("L").point(lambda pixel: 0 if pixel < 180 else 255, mode="1").save(folder / f"{case['name']}-{index + 1}-monochrome.png")
print(f"Verified {total} PGW unsigned preparation pages from exact public source; fictional protected alternatives only, no signatures or submission.")
