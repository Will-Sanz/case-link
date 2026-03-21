export type ParsedResourceRow = {
  officeOrDepartment: string;
  programName: string;
  description: string | null;
  category: string | null;
  inviteMarchPartnerFair: boolean | null;
  partnerFairAttended: string | null;
  recruitForGroceryGiveaways: boolean | null;
  primaryContactName: string | null;
  primaryContactTitle: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  primaryContactPhoneNorm: string | null;
  secondaryContactName: string | null;
  secondaryContactTitle: string | null;
  secondaryContactEmail: string | null;
  secondaryContactPhone: string | null;
  secondaryContactPhoneNorm: string | null;
  servicesSelectAll: string | null;
  additionalInfo: string | null;
  tablingAtEvents: boolean;
  promotionalMaterials: boolean;
  educationalWorkshops: boolean;
  volunteerRecruitmentSupport: boolean;
  importKey: string;
  slug: string;
  tags: string[];
  searchText: string;
};

export type CsvParseIssue = {
  rowNumber: number;
  message: string;
  rawPreview?: string;
};
