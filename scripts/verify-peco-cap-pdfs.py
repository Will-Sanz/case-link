"""Independent text/region/structure checks for synthetic PECO drafts; no network."""
import json
import hashlib
from pathlib import Path
import sys
import pypdfium2 as pdfium
from pypdf import PdfReader

folder = Path(sys.argv[1])
source_path = Path("tests/fixtures/parent/peco-cap-2026.pdf")
source = pdfium.PdfDocument(source_path)
normalize = lambda value: " ".join(value.split())

# PDFium's bounded extraction includes glyphs merely touching an edge (e.g. a
# printed field label above its blank). Check glyph centers inside the field.
def box_text(page, box):
    left, bottom, right, top = box
    text = page.get_textpage()
    chars = []
    for i in range(text.count_chars()):
        char = text.get_text_range(i, 1)
        if char in "\r\n":
            chars.append(" ")
            continue
        l, b, r, t = text.get_charbox(i)
        if left <= (l + r) / 2 <= right and bottom <= (b + t) / 2 <= top:
            chars.append(char)
    return normalize("".join(chars))

# Coordinates independently read from the official source, not renderer exports.
def region(page, box):
    left, bottom, right, top = box
    return box_text(page, (left * .94 + 18.36, bottom * .94 + 32,
                          right * .94 + 18.36, top * .94 + 32))

for case in json.loads((folder / "cases.json").read_text()):
    path = folder / f"{case['name']}.pdf"
    reader = PdfReader(path)
    assert "/AcroForm" not in reader.trailer["/Root"], "Hidden form tree remains"
    for page in reader.pages:
        assert all(a.get_object().get("/Subtype") != "/Widget" for a in page.get("/Annots", [])), "Orphan widget remains"
    document = pdfium.PdfDocument(path)
    assert len(document) == case["pages"], "Household overflow page count changed"
    facts = case["input"]
    first = document[0]
    assert region(first, (37, 510, 303, 524)) == facts["accountNumber"], "Wrong account field"
    assert region(first, (304, 510, 591, 524)) == facts.get("homePhone", ""), "Wrong home-phone field"
    assert region(first, (37, 487, 247, 500)) == facts["applicant"]["lastName"], "Wrong last-name field"
    assert region(first, (247, 487, 466, 500)) == facts["applicant"]["firstName"], "Wrong first-name/diacritics field"
    assert region(first, (466, 487, 591, 500)) == facts["applicant"].get("middleInitial", ""), "Wrong middle-initial field"
    assert region(first, (36, 464, 467, 477)) == facts["address"]["street"], "Wrong address field"
    assert region(first, (467, 464, 591, 477)) == facts["address"].get("apartment", ""), "Wrong apartment field"
    assert region(first, (36, 441, 246, 454)) == facts["address"]["city"], "Duplicate City widget obscured data"
    assert region(first, (246, 441, 466, 454)) == facts["address"]["state"], "Wrong state field"
    assert region(first, (467, 441, 590, 454)) == facts["address"]["zip"], "Wrong ZIP field"
    assert region(first, (36, 419, 247, 431)) == facts.get("cellPhone", ""), "Duplicate Cell widget obscured data"
    assert region(first, (298, 422, 313, 438)) == ("X" if facts.get("smsUpdates") else ""), "SMS choice changed"
    assert not region(first, (197, 206, 331, 323)), "Optional identifier column populated"
    assert not region(first, (358, 83, 590, 100)), "Applicant signature populated"
    people = [facts["applicant"], *facts["householdMembers"]]
    for i, person in enumerate(people[:5]):
        # Safe interior of each printed household row, avoiding table headings.
        top = 323 - i * 23.875
        bottom = top - 21.5
        expected_name = f"{person['lastName']}, {person['firstName']}" + (f", {person['middleInitial']}" if person.get("middleInitial") else "")
        assert region(first, (37, bottom, 195, top)) == expected_name, "Household name order/row changed"
        year, month, day = person["dateOfBirth"].split("-")
        assert region(first, (332, bottom, 397, top)) == f"{month}/{day}/{year}", "DOB moved or changed"
        assert region(first, (398, bottom, 467, top)) == ("SELF" if i == 0 else person["relationship"]), "Relationship moved or changed"
        assert region(first, (468, bottom, 591, top)) == person.get("incomeSource", ""), "Income source moved or changed"
    for i, person in enumerate(people[5:]):
        page = document[2 + i // 22]
        bottom = 658 - (i % 22) * 28
        def continuation(left, right):
            return box_text(page, (left, bottom, right, bottom + 21))
        expected_name = f"{person['lastName']}, {person['firstName']}" + (f", {person['middleInitial']}" if person.get("middleInitial") else "")
        year, month, day = person["dateOfBirth"].split("-")
        assert continuation(37, 195) == expected_name, "Overflow name moved or changed"
        assert continuation(332, 397) == f"{month}/{day}/{year}", "Overflow DOB moved or changed"
        assert continuation(398, 467) == person["relationship"], "Overflow relationship moved or changed"
        assert continuation(468, 591) == person.get("incomeSource", ""), "Overflow income source moved or changed"
        assert not continuation(197, 331), "Overflow optional identifier populated"
    for box in [(60, 51, 75, 60), (59, 37, 74, 45), (60, 23, 74, 32),
                (204, 21, 220, 31), (204, 35, 220, 45), (347, 36, 363, 45),
                (347, 21, 363, 31), (347, 50, 364, 60), (204, 51, 220, 60)]:
        assert not region(document[1], box), "Unrequested outreach choice selected"
    all_text = " ".join(normalize(page.get_textpage().get_text_range()) for page in document)
    for person in people:
        assert f"{person['lastName']}, {person['firstName']}" in all_text, "Household member dropped"
    for i, page in enumerate(document):
        assert page.get_size() == (612, 792), "Letter page geometry changed"
        text_page = page.get_textpage()
        text = normalize(text_page.get_text_range())
        assert "UNSIGNED PREPARATION DRAFT - NOT SENT" in text, "Draft falsely appears ready/sent"
        footer = normalize(text_page.get_text_bounded(left=0, bottom=0, right=612, top=30))
        assert facts["accountNumber"] in footer and facts["applicant"]["lastName"] in footer, "Fax page lacks applicant identity"
        assert f"Page {i + 1} of {len(document)}" in footer, "Incorrect final packet pagination"
        assert text.count("UNSIGNED PREPARATION DRAFT - NOT SENT") == 1, "Page band duplicated"
        for index in range(text_page.count_chars()):
            left, bottom, right, top = text_page.get_charbox(index)
            assert 0 <= left <= right <= 612 and 0 <= bottom <= top <= 792, "Text outside page"
        # Every printed official line survives; new values occupy formerly blank fields.
        if i < 2:
            for line in source[i].get_textpage().get_text_range().splitlines():
                if normalize(line):
                    assert normalize(line) in text, "Official instructions/certification text lost"
        page.render(scale=1.6).to_pil().save(folder / f"{case['name']}-{i + 1}.png")
        # A legibility rehearsal only; this does not exercise a real fax carrier.
        page.render(scale=200 / 72).to_pil().convert("L").point(
            lambda pixel: 0 if pixel < 180 else 255, mode="1"
        ).save(folder / f"{case['name']}-{i + 1}-monochrome.png")
    assert len(reader.pages[1].get("/Annots", [])) == 1, "Official non-widget link lost or expanded"
    if "projection" in case:
        projection = case["projection"]
        manifest, snapshot, context = projection["manifest"], projection["sourceSnapshot"], projection["context"]
        digest = lambda data: hashlib.sha256(data).hexdigest()
        encoded = lambda data: json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        assert context["kind"] == "fictional_offline_rehearsal", "Projection was not a fictional rehearsal"
        assert projection["incomeProof"] == "not_assessed" and projection["submissionReady"] is False, "Draft claims proof or submission readiness"
        assert manifest["sourceSnapshot"] == {"id": snapshot["id"], "revision": snapshot["revision"], "sha256": digest(encoded(snapshot))}, "Private source snapshot changed"
        assert manifest["binding"] == context["binding"] == context["expectedSnapshot"]["binding"], "Projection scope changed"
        assert manifest["artifactSha256"] == digest(path.read_bytes()) and manifest["templateSha256"] == digest(source_path.read_bytes()), "Projection artifact/source hash changed"
        assert manifest["formInputSha256"] == digest(encoded(facts)), "Projected form values changed"
        assert manifest["subjectIds"] == [snapshot["details"]["applicant"]["id"], *[person["id"] for person in snapshot["details"]["householdMembers"]]], "Projection subject identity changed"
        assert manifest["confirmedAt"] == min([snapshot["created_at"], *[item["confirmedAt"] for item in snapshot["provenance"].values()]]), "Projection refreshed original field dates"
        assert manifest["validUntil"] == manifest["retentionUntil"] == min(context["validUntil"], context["retentionUntil"], context["mandate"]["expiresAt"], context["grant"]["expiresAt"], context["collection"]["expiresAt"], snapshot["source"]["verifiedUntil"]), "Projection extended a deadline"
        projected = {"id": snapshot["id"], "revision": snapshot["revision"], "binding": manifest["binding"], "subjectIds": manifest["subjectIds"], "confirmedAt": manifest["confirmedAt"], "validUntil": manifest["validUntil"], "retentionUntil": manifest["retentionUntil"], "details": facts}
        assert manifest["preparationSnapshot"]["sha256"] == digest(encoded(projected)), "Projected reference does not bind printed values"
        assert facts["applicant"]["incomeSource"] == "No income" and "incomeSource" not in facts["householdMembers"][0], "Fictional declared-none and blank-minor case lost"
    if "packet" in case:
        packet = case["packet"]
        manifest = packet["manifest"]
        digest = lambda data: hashlib.sha256(data).hexdigest()
        assert manifest["artifactSha256"] == digest(path.read_bytes()), "Final artifact digest changed"
        assert manifest["templateSha256"] == digest(source_path.read_bytes()), "Source digest changed"
        assert manifest["certificationTemplateSha256"] == digest(source_path.read_bytes()), "Certification source changed"
        assert manifest["kind"] == "unsigned_preparation_rehearsal", "Unexpected execution claim"
        snapshot = packet["preparationSnapshot"]
        assert manifest["preparationSnapshot"] == {
            "id": snapshot["id"], "revision": snapshot["revision"],
            "sha256": digest(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
        }, "Printed details lost their trusted snapshot binding"
        assert snapshot["details"] == facts, "Printed facts differ from the referenced snapshot"
        assert manifest["pageCount"] == len(document), "Manifest total mismatch"
        expected_start = 2 + (max(0, len(people) - 5) + 21) // 22 + 1
        seen_ranges = {}
        for reference in manifest["originals"]:
            original_ref = next(item for item in packet["originals"] if item["documentId"] == reference["documentId"])
            original_path = folder / original_ref["filename"]
            original_bytes = original_path.read_bytes()
            assert digest(original_bytes) == reference["sourceSha256"], "Original source bytes changed"
            original = pdfium.PdfDocument(original_path)
            assert reference["pageCount"] == len(original), "Original page count changed"
            actual_range = (reference["outputStartPage"], reference["outputEndPage"], reference["pageCount"])
            if reference["sourceSha256"] in seen_ranges:
                assert actual_range == seen_ranges[reference["sourceSha256"]], "Original alias range differs"
                continue
            seen_ranges[reference["sourceSha256"]] = actual_range
            assert reference["outputStartPage"] == expected_start, "Proof range has a gap/duplicate"
            assert reference["outputEndPage"] == expected_start + len(original) - 1, "Proof range truncated"
            for index, original_page in enumerate(original):
                copied = document[expected_start - 1 + index]
                assert not reader.pages[expected_start - 1 + index].get("/Annots", []), "Evidence annotation introduced"
                original_text = original_page.get_textpage()
                copied_text = copied.get_textpage()
                for char_index in range(original_text.count_chars()):
                    char = original_text.get_text_range(char_index, 1)
                    if not char.strip():
                        continue
                    left, bottom, right, top = original_text.get_charbox(char_index)
                    expected = (left * .92 + 24.48, bottom * .92 + 36,
                                right * .92 + 24.48, top * .92 + 36)
                    actual = box_text(copied, expected)
                    assert actual == normalize(char), "Evidence glyph content/transform changed"
                text = normalize(copied_text.get_text_range())
                for line in original_text.get_text_range().splitlines():
                    assert normalize(line) in text, "Original evidence text lost"
                assert f"Original page {index + 1} of {len(original)}" in text, "Evidence-copy label missing"
                # Compare independently rasterized original content at the exact scale.
                # Pixel antialiasing can differ by a fraction of a pixel, so compare dark bounds and ink area.
                original_image = original_page.render(scale=.92 * 2).to_pil().convert("L")
                copy_image = copied.render(scale=2).to_pil().convert("L")
                left = round(24.48 * 2)
                top = round((792 - 36 - 792 * .92) * 2)
                cropped = copy_image.crop((left, top, left + original_image.width, top + original_image.height))
                original_ink = original_image.point(lambda value: 255 if value < 180 else 0)
                copied_ink = cropped.point(lambda value: 255 if value < 180 else 0)
                original_area = sum(i * count for i, count in enumerate(original_ink.histogram()))
                copied_area = sum(i * count for i, count in enumerate(copied_ink.histogram()))
                assert 0 < original_area / (255 * original_image.width * original_image.height) < .08, "Synthetic evidence text is obscured"
                assert abs(original_area - copied_area) / max(1, original_area) < .08, "Evidence raster ink lost"
                if reference["documentId"] == "proof-1":
                    # The first synthetic source embeds a real two-color PNG, not a vector placeholder.
                    original_rgb = original_page.render(scale=.92 * 2).to_pil().convert("RGB")
                    copied_rgb = copied.render(scale=2).to_pil().convert("RGB")
                    for image_x, image_y in [(54, 584), (102, 584), (54, 632), (102, 632)]:
                        source_point = (round(image_x * .92 * 2), round((792 - image_y) * .92 * 2))
                        output_point = (round((image_x * .92 + 24.48) * 2), round((792 - image_y * .92 - 36) * 2))
                        source_color = original_rgb.getpixel(source_point)
                        copied_color = copied_rgb.getpixel(output_point)
                        assert source_color in [(39, 76, 119), (228, 145, 65)], "Embedded PNG patch absent"
                        assert max(abs(a - b) for a, b in zip(source_color, copied_color)) <= 2, "Embedded PNG colors changed"
                original_page.render(scale=1.6).to_pil().save(folder / f"{case['name']}-original-{reference['documentId']}-{index + 1}.png")
            expected_start += len(original)
        assert expected_start == len(document) + 1, "Unmanifested output pages"
    print(f"Verified {case['name']}: {len(document)} pages; exact source fields, blank identifiers/signature, preserved text/link, bounds and renders.")
