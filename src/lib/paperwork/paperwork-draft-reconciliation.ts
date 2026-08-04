import type { PdfFieldMapping } from "@/types/paperwork";

function normalizedMapping(mapping: PdfFieldMapping): PdfFieldMapping {
  return {
    ...mapping,
    reviewState: mapping.reviewState ?? (mapping.needsReview ? "suggested" : "ready"),
    baselineValue: mapping.baselineValue ?? mapping.value,
    baselineSource: mapping.baselineSource ?? mapping.source,
  };
}

export function normalizePaperworkMappings(
  mappings: PdfFieldMapping[],
): PdfFieldMapping[] {
  return mappings.map(normalizedMapping);
}

function markOutOfDate(
  saved: PdfFieldMapping,
  current: PdfFieldMapping,
): PdfFieldMapping {
  return {
    ...saved,
    needsReview: true,
    reviewState: "out_of_date",
    proposedValue: current.value,
    proposedSource: current.source,
    proposedConfidence: current.confidence,
    proposedNeedsReview: current.needsReview,
  };
}

/**
 * Compare regenerated suggestions with the exact suggestion baseline used by a
 * local draft. Existing values remain untouched until the case manager chooses.
 */
export function reconcilePaperworkMappings(
  savedMappings: PdfFieldMapping[],
  currentSuggestions: PdfFieldMapping[],
): PdfFieldMapping[] {
  const saved = normalizePaperworkMappings(savedMappings);
  const currentByName = new Map(
    normalizePaperworkMappings(currentSuggestions).map((mapping) => [mapping.fieldName, mapping]),
  );
  const reconciled = saved.map((mapping) => {
    const current = currentByName.get(mapping.fieldName);
    currentByName.delete(mapping.fieldName);
    if (!current) {
      return markOutOfDate(mapping, {
        fieldName: mapping.fieldName,
        value: "",
        confidence: "low",
        source: "No current reviewed-plan source",
        needsReview: true,
      });
    }
    const baselineValue = mapping.baselineValue ?? mapping.value;
    const baselineSource = mapping.baselineSource ?? mapping.source;
    if (current.value !== baselineValue || current.source !== baselineSource) {
      return markOutOfDate(mapping, current);
    }
    return mapping;
  });

  for (const current of currentByName.values()) {
    reconciled.push(
      markOutOfDate(
        {
          fieldName: current.fieldName,
          value: "",
          confidence: "low",
          source: "Newly detected field",
          needsReview: true,
          reviewState: "suggested",
          baselineValue: "",
          baselineSource: "Newly detected field",
        },
        current,
      ),
    );
  }

  return reconciled;
}

function withoutProposal(mapping: PdfFieldMapping): PdfFieldMapping {
  const next = { ...mapping };
  delete next.proposedValue;
  delete next.proposedSource;
  delete next.proposedConfidence;
  delete next.proposedNeedsReview;
  return next;
}

export function acceptUpdatedPaperworkSuggestion(
  mapping: PdfFieldMapping,
): PdfFieldMapping {
  const proposedValue = mapping.proposedValue ?? "";
  const proposedSource = mapping.proposedSource ?? "Updated reviewed plan";
  return withoutProposal({
    ...mapping,
    value: proposedValue,
    confidence: mapping.proposedConfidence ?? "low",
    source: proposedSource,
    needsReview: false,
    reviewState: "accepted",
    baselineValue: proposedValue,
    baselineSource: proposedSource,
  });
}

export function keepCurrentPaperworkValue(
  mapping: PdfFieldMapping,
): PdfFieldMapping {
  const source = mapping.source.toLowerCase();
  const reviewState = source.startsWith("edited by")
    ? "edited"
    : source.startsWith("left blank")
      ? "left_blank"
      : "accepted";
  return withoutProposal({
    ...mapping,
    needsReview: false,
    reviewState,
    baselineValue: mapping.proposedValue ?? mapping.baselineValue ?? mapping.value,
    baselineSource: mapping.proposedSource ?? mapping.baselineSource ?? mapping.source,
  });
}

export function paperworkOutOfDateCount(mappings: PdfFieldMapping[]): number {
  return mappings.filter((mapping) => mapping.reviewState === "out_of_date").length;
}
