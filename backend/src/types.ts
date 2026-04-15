export type UserRole =
  | "super_admin"
  | "admin"
  | "receptionist"
  | "technician"
  | "pathologist"
  | "doctor"
  | "finance"
  | "courier";

export type OrderPriority = "normal" | "urgent";
export type OrderStatus =
  | "draft"
  | "received"
  | "in_progress"
  | "review"
  | "completed"
  | "released"
  | "cancelled";

export type CourierStatus =
  | ""
  | "ready_for_pickup"
  | "on_way_to_pickup"
  | "at_site_for_pickup"
  | "picked_up_on_way_to_lab"
  | "in_transit"
  | "received_at_lab";

export type SampleStatus =
  | "pending"
  | "received"
  | "grossed"
  | "processed"
  | "embedded"
  | "sectioned"
  | "stained"
  | "ready_for_review";

export type PaymentStatus = "pending" | "completed" | "failed";
export type PaymentMethod =
  | "cash"
  | "card"
  | "mobile_money"
  | "bank_transfer"
  | "mtn_mobile_money"
  | "orange_money"
  | "transfer"
  | "other";

export type PaymentProvider = "manual" | "maviance";

export type MavianceChannel = "mtn_cameroon" | "orange_cameroon";
export type FormLanguage = "en" | "fr";

export type OrderWorkflowStageId =
  | "accessioning"
  | "grossing"
  | "processing"
  | "embedding"
  | "sectioning"
  | "staining"
  | "cytology_case"
  | "cytology_qc"
  | "ihc"
  | "analyzer_run"
  | "molecular_sendout"
  | "pathologist_review"
  | "report_signout"
  | "result_release";

export type OrderWorkflowModule =
  | "histology"
  | "cytology"
  | "ihc"
  | "analyzer"
  | "molecular"
  | "pathology";

export interface OrderWorkflowStageState {
  id: OrderWorkflowStageId;
  label: string;
  description: string;
  module: OrderWorkflowModule;
  status: "complete" | "current" | "pending";
}

export interface OrderWorkflowPlan {
  summary: string;
  routeTags: string[];
  requiresTechnician: boolean;
  nextStageId: OrderWorkflowStageId | null;
  nextStageLabel: string | null;
  nextModule: OrderWorkflowModule | null;
  reviewReady: boolean;
  stages: OrderWorkflowStageState[];
}

export interface OrderWorkflowRouteGuide {
  key: string;
  testTypeId: string;
  testCode: string;
  testName: string;
  category: string;
  stages: OrderWorkflowStageId[];
  routeTags: string[];
  requiresAccession: boolean;
  primaryModule: OrderWorkflowModule;
}

export interface OrderVisibilityBlocker {
  code: string;
  ownerRole: string;
  title: string;
  message: string;
}

export type MavianceTransactionState =
  | "quote_created"
  | "collection_requested"
  | "pending"
  | "success"
  | "errored"
  | "reversed"
  | "under_investigation";

export interface User {
  _id: string;
  email: string;
  name: string;
  role: UserRole;
  preferredLanguage: "english" | "french";
  preferredLocale: "en" | "fr";
  siteId?: string | null;
  active: boolean;
  passwordHash: string;
  mfaEnabled?: boolean;
  mfaSecret?: string | null;
  mfaVerifiedAt?: string | null;
  failedLoginCount?: number;
  lockedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Doctor {
  _id: string;
  name: string;
  code: string;
  type: "doctor" | "clinic";
  email: string;
  phone: string;
  active: boolean;
  siteId?: string | null;
  userId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Patient {
  _id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "male" | "female" | "other";
  phone: string;
  email: string;
  address: string;
  siteId?: string | null;
  externalPatientId?: string | null;
  nationalId?: string;
  anonymized?: boolean;
  anonymousLabel?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestType {
  _id: string;
  code: string;
  name: string;
  description?: string;
  category: "Histology" | "Cytology" | "Molecular" | "IHC" | string;
  price: number;
  turnaroundHours?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RequisitionSpecimenRow {
  source: string;
  clinicalImpression: string;
}

export interface RequisitionForm {
  language: FormLanguage;
  physicianSignatureName?: string;
  placeDate?: string;
  requisitionCompletedBy?: string;
  requisitionCompletedByPhone?: string;
  patientEthnicity?: string;
  referringPhysicianName?: string;
  referringPhysicianAddress?: string;
  referringPhysicianCity?: string;
  referringPhysicianRegion?: string;
  referringPhysicianPhone?: string;
  referringPhysicianEmail?: string;
  sendResultsToPhysician?: boolean;
  sendResultsToPatient?: boolean;
  referringFacilityName?: string;
  referringFacilityAddress?: string;
  billingMode?: "insurance_employer" | "self_pay" | "guarantor";
  insuranceName?: string;
  insuranceNumber?: string;
  policyHolder?: string;
  insuranceContactPhone?: string;
  guarantorName?: string;
  guarantorPhone?: string;
  collectionDate?: string;
  collectionTime?: string;
  diagnosis?: string;
  preOperativeDiagnosis?: string;
  postOperativeDiagnosis?: string;
  medicalHistory?: string;
  clinicalHistory?: string;
  additionalRequests?: string;
  specimenType?: string;
  formalinAddedTime?: string;
  otherTestsRequested?: string;
  specimenFlags?: {
    fluid?: boolean;
    biopsyMultiple?: boolean;
    surgicalResection?: boolean;
    gynPap?: boolean;
    boneMarrow?: boolean;
    boneMarrowAspirate?: boolean;
    blood?: boolean;
    slides?: boolean;
    cassetteParaffinBlock?: boolean;
  };
  specimenRows?: RequisitionSpecimenRow[];
}

export interface OrderNumberReservation {
  _id: string;
  orderNumber: string;
  language: FormLanguage;
  verificationToken: string;
  status: "reserved" | "consumed" | "expired";
  source: "public_form";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  consumedAt?: string | null;
}

export interface Payment {
  _id: string;
  orderId: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  provider?: PaymentProvider;
  providerChannel?: MavianceChannel | null;
  providerStatus?: string | null;
  providerErrorCode?: string | null;
  providerTransactionNumber?: string | null;
  providerTransactionReference?: string | null;
  gatewayReference?: string | null;
  receiptNumber?: string | null;
  verificationCode?: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedWithPatientAt?: string | null;
  externalAccountingId?: string | null;
  accountingSyncStatus?: "pending" | "success" | "failed";
  accountingSyncedAt?: string | null;
}

export interface MavianceTransaction {
  _id: string;
  orderId: string;
  paymentId?: string | null;
  siteId?: string | null;
  channel: MavianceChannel;
  merchantCode: string;
  serviceId: string;
  payItemId?: string | null;
  quoteId?: string | null;
  amount: number;
  currency: "XAF";
  customerPhone: string;
  customerEmail: string;
  customerName?: string | null;
  customerAddress?: string | null;
  customerNumber?: string | null;
  serviceNumber?: string | null;
  tag?: string | null;
  cdata?: string | null;
  ptn?: string | null;
  receiptNumber?: string | null;
  verificationCode?: string | null;
  externalTransactionId?: string | null;
  providerStatus: string;
  normalizedStatus: MavianceTransactionState;
  errorCode?: string | null;
  errorMessage?: string | null;
  callbackDeliveryId?: string | null;
  callbackSignatureValidated?: boolean;
  liveMode: boolean;
  quotePayload?: string | null;
  collectPayload?: string | null;
  verifyPayload?: string | null;
  createdAt: string;
  updatedAt: string;
  quotedAt?: string | null;
  collectedAt?: string | null;
  verifiedAt?: string | null;
  settledAt?: string | null;
}

export interface HistologyIhcEntry {
  _id: string;
  antibody: string;
  clone: string;
  antigenRetrieval: string;
  detection: string;
  counterstain: string;
  qcNotes?: string;
  createdAt: string;
}

export interface HistologySlide {
  _id: string;
  slideId: string;
  stainStatus: "pending" | "stained";
  stainType: string;
  stainedAt?: string | null;
  imageUrls: string[];
  ihcEntries: HistologyIhcEntry[];
}

export interface HistologyBlock {
  _id: string;
  blockId: string;
  embeddedAt?: string | null;
  sectionedAt?: string | null;
  slides: HistologySlide[];
}

export interface Accession {
  _id: string;
  accessionId: string;
  orderId: string;
  receivedAt: string;
  receivedBy: string;
  numberOfBlocks: number;
  grossDescription?: string;
  grossedAt?: string | null;
  grossedBy?: string | null;
  processingNotes?: string;
  processedAt?: string | null;
  embeddedAt?: string | null;
  sectionedAt?: string | null;
  stainedAt?: string | null;
  blocks: HistologyBlock[];
  createdAt: string;
  updatedAt: string;
}

export interface Sample {
  _id: string;
  accessionId: string;
  orderId: string;
  label: string;
  type: string;
  status: SampleStatus;
  location?: string;
  barcodeId?: string | null;
  parentSampleId?: string | null;
  rejectionReason?: string | null;
  discrepancyFlag?: boolean;
  storageLocation?: string | null;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Report {
  _id: string;
  orderId: string;
  accessionId?: string | null;
  status: "draft" | "complete";
  diagnosis: string;
  microscopicDescription: string;
  grossDescription: string;
  comment: string;
  emailedAt?: string | null;
  lockedAt?: string | null;
  authorId?: string | null;
  templateId?: string | null;
  signedBy?: string | null;
  signedAt?: string | null;
  releaseRuleStatus?: "pending" | "ready" | "released";
  versions?: Array<{
    version: number;
    diagnosis: string;
    microscopicDescription: string;
    comment: string;
    createdAt: string;
  }>;
  addenda?: Array<{
    _id: string;
    note: string;
    authorId: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface CytologyCase {
  _id: string;
  orderId: string;
  caseNumber: string;
  specimenType: string;
  status: "open" | "review" | "complete";
  remarks: string;
  routeType?: "gyn" | "non_gyn";
  preparationType?: "smear" | "cell_block" | "liquid_based";
  qcStatus?: "pending" | "pass" | "fail";
  qcNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  steps: string[];
}

export interface WorkflowHistoryEntry {
  _id: string;
  workflowTemplateId: string;
  workflowTemplateName: string;
  orderId?: string;
  patientName?: string;
  completedAt: string;
  notes?: string;
}

export interface Notification {
  _id: string;
  title: string;
  body: string;
  read: boolean;
  audienceRoles?: UserRole[] | null;
  audienceUserIds?: string[] | null;
  siteId?: string | null;
  readBy?: Array<{
    userId: string;
    readAt: string;
  }> | null;
  createdAt: string;
  updatedAt?: string;
}

export interface Order {
  _id: string;
  orderNumber: string;
  patientId: string;
  testTypeIds: string[];
  status: OrderStatus;
  priority: OrderPriority;
  orderSource: "walk_in" | "online" | "referral";
  referringDoctorId?: string | null;
  referringDoctorName?: string | null;
  createdBy: string;
  assignedTechnicianId?: string | null;
  assignedPathologistId?: string | null;
  notes?: string;
  clinicalHistory?: string;
  validationStatus?: "pending" | "validated" | "rejected";
  validationNotes?: string;
  intakeSource?: "manual" | "portal" | "ocr_nlp";
  financialClearance?: "pending" | "cleared" | "blocked";
  siteId?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  courierStatus: CourierStatus;
  pickupAddress?: string | null;
  pickupPlaceName?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  requisitionForm?: RequisitionForm | null;
  receivedAt?: string | null;
  receivedByUserId?: string | null;
  courierCheckedInAt?: string | null;
  courierReceivedAt?: string | null;
  triagedAt?: string | null;
  triagedBy?: string | null;
  workflowReleasedAt?: string | null;
  workflowReleasedBy?: string | null;
  paymentCollectionStatus?:
    | "unpaid"
    | "cash_with_courier"
    | "paid_online"
    | "payment_prompt_sent"
    | "cash_received_at_reception"
    | "reconciled";
  paymentCollectionMethod?: PaymentMethod | null;
  paymentCollectionAmount?: number | null;
  paymentCollectionReference?: string | null;
  paymentCollectionDeclaredBy?: string | null;
  paymentCollectionDeclaredAt?: string | null;
  paymentPromptSentAt?: string | null;
  paymentPromptRecipient?: string | null;
  anonymousCaseCode?: string | null;
  requesterNotificationEmail?: string | null;
  requesterNotificationPhone?: string | null;
  completedAt?: string | null;
  releasedAt?: string | null;
  lockStatus?: "unlocked" | "locked";
  lockedAt?: string | null;
  lockedBy?: string | null;
  lockReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  userId: string;
  userName: string;
  role: UserRole;
  approvedAt: string;
}

export interface OrderAmendment {
  _id: string;
  orderId: string;
  type: "amendment" | "add_on" | "cancellation";
  reason: string;
  details: string;
  createdBy: string;
  status?: "pending" | "approved" | "rejected" | "applied";
  policyLevel?: "standard" | "controlled" | "legal";
  requiredApprovals?: number;
  approvals?: ApprovalRecord[];
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  appliedBy?: string | null;
  appliedAt?: string | null;
  beforeSnapshot?: string | null;
  afterSnapshot?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface OcrIntakeJob {
  _id: string;
  source: "upload" | "manual_text";
  originalFilename?: string | null;
  mimeType?: string | null;
  rawText: string;
  parsedPayload: string;
  confidence: number;
  fieldConfidences: string;
  status: "needs_verification" | "verified" | "rejected" | "converted_to_order";
  requiredHumanVerification: boolean;
  verificationNotes?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  convertedOrderId?: string | null;
  createdBy: string;
  siteId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderCorrection {
  _id: string;
  orderId: string;
  reason: string;
  changes: string;
  status: "pending" | "approved" | "rejected" | "applied";
  requiredApprovals: number;
  approvals: ApprovalRecord[];
  requestedBy: string;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  appliedBy?: string | null;
  appliedAt?: string | null;
  beforeSnapshot: string;
  afterSnapshot?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderLockRecord {
  _id: string;
  orderId: string;
  status: "active" | "released";
  reason: string;
  lockedBy: string;
  lockedAt: string;
  releasedBy?: string | null;
  releasedAt?: string | null;
  releaseReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsuranceAuthorization {
  _id: string;
  orderId: string;
  payerName: string;
  policyNumber: string;
  preAuthCode: string;
  status: "pending" | "approved" | "denied";
  approvedAmount: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  _id: string;
  orderId: string;
  invoiceNumber: string;
  subtotal: number;
  adjustmentAmount: number;
  total: number;
  status: "draft" | "issued" | "paid" | "refunded";
  paymentGateway:
    | "cash"
    | "card"
    | "mpesa"
    | "maviance"
    | "bank_transfer"
    | "insurance";
  externalAccountingId?: string | null;
  externalCustomerId?: string | null;
  accountingSyncStatus?: "pending" | "success" | "failed";
  accountingSyncedAt?: string | null;
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefundAdjustment {
  _id: string;
  orderId: string;
  invoiceId?: string | null;
  type: "refund" | "adjustment";
  amount: number;
  reason: string;
  status: "pending" | "approved" | "completed" | "rejected";
  createdBy?: string | null;
  requiredApprovals?: number;
  approvals?: ApprovalRecord[];
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  completedBy?: string | null;
  completedAt?: string | null;
  reversalJournalEntryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingAccount {
  _id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  normalBalance: "debit" | "credit";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingJournalEntry {
  _id: string;
  entryNumber: string;
  orderId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  entryType: "invoice" | "payment" | "refund" | "adjustment" | "export";
  debitAccount: string;
  creditAccount: string;
  amount: number;
  currency: Settings["currency"];
  memo: string;
  status: "draft" | "posted" | "void";
  postedAt?: string | null;
  voidedBy?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  reversalOfEntryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingExportBatch {
  _id: string;
  provider: "generic" | "quickbooks" | "sage" | "odoo" | "custom";
  status: "queued" | "sent" | "failed";
  entryIds: string[];
  endpoint?: string | null;
  requestPayload: string;
  responsePayload?: string | null;
  errorMessage?: string | null;
  exportedBy: string;
  exportedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ZohoBooksSyncLog {
  _id: string;
  entityType:
    | "oauth"
    | "organization"
    | "contact"
    | "invoice"
    | "payment"
    | "refund";
  entityId?: string | null;
  orderId?: string | null;
  provider: "zoho_books";
  operation:
    | "authorize_url"
    | "token_exchange"
    | "list_organizations"
    | "sync_contact"
    | "sync_invoice"
    | "sync_payment"
    | "sync_refund";
  status: "queued" | "success" | "failed";
  externalId?: string | null;
  endpoint: string;
  requestPayload?: string | null;
  responsePayload?: string | null;
  errorMessage?: string | null;
  siteId?: string | null;
  syncedBy?: string | null;
  syncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BarcodeRecord {
  _id: string;
  code: string;
  symbology: "gs1_128" | "qr" | "code128";
  entityType: "specimen" | "block" | "slide" | "case";
  entityId?: string | null;
  status: "unassigned" | "assigned" | "printed" | "archived";
  templateId?: string | null;
  justification?: string;
  printedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BarcodeScanEvent {
  _id: string;
  barcodeId?: string | null;
  code: string;
  entityType?: BarcodeRecord["entityType"] | null;
  entityId?: string | null;
  workflowStep: string;
  outcome: "accepted" | "rejected";
  reason?: string | null;
  scannedBy: string;
  createdAt: string;
}

export interface LabelTemplateRecord {
  _id: string;
  name: string;
  printerName: string;
  templateType: "specimen" | "block" | "slide" | "case";
  scanEnforced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChainOfCustodyEvent {
  _id: string;
  specimenId: string;
  eventType:
    | "collected"
    | "picked_up"
    | "received"
    | "aliquoted"
    | "transferred"
    | "handoff"
    | "rejected";
  location: string;
  condition: string;
  actor: string;
  handedOffTo?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  temperatureCelsius?: number | null;
  notes?: string;
  createdAt: string;
}

export interface PreAnalyticsLog {
  _id: string;
  orderId: string;
  specimenId?: string | null;
  collectionAt: string;
  pickupAt?: string | null;
  receiptAt?: string | null;
  transportTemperature: string;
  transportCondition: string;
  receiptValidated: boolean;
  tatMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface HistologyWorklistItem {
  _id: string;
  accessionId: string;
  taskType:
    | "grossing"
    | "processing"
    | "embedding"
    | "sectioning"
    | "staining"
    | "recut"
    | "special_stain";
  status: "pending" | "in_progress" | "complete";
  assignedTo?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CytologyQualityRecord {
  _id: string;
  cytologyCaseId: string;
  routeType: "gyn" | "non_gyn";
  preparationType: "smear" | "cell_block" | "liquid_based";
  qcStatus: "pending" | "pass" | "fail";
  qcNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AntibodyInventoryItem {
  _id: string;
  antibody: string;
  clone: string;
  lotNumber: string;
  quantity: number;
  unit: string;
  expiresAt: string;
  controlSlideTracked: boolean;
  qcStatus: "pass" | "hold" | "fail";
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DigitalSlideRecord {
  _id: string;
  orderId: string;
  slideId: string;
  scannerVendor: string;
  metadata: string;
  viewerUrl: string;
  connectorId?: string | null;
  externalCaseId?: string | null;
  externalSlideId?: string | null;
  scanStatus?: "requested" | "scanning" | "available" | "failed";
  scannedAt?: string | null;
  ownerId?: string | null;
  signOutStatus: "pending" | "reviewed" | "signed_out";
  createdAt: string;
  updatedAt: string;
}

export interface AiAnalysisResult {
  _id: string;
  slideId: string;
  analysisType: "qc" | "ki67" | "ihc_scoring" | "tumor_detection";
  version: string;
  score: string;
  explainability: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export interface InstrumentConnection {
  _id: string;
  name: string;
  vendor?: string | null;
  instrumentType?: string | null;
  protocol: "HL7" | "FHIR" | "REST";
  status: "online" | "offline" | "degraded";
  siteId?: string | null;
  externalDeviceId?: string | null;
  lastSyncAt?: string | null;
  lastHeartbeatAt?: string | null;
  bidirectional: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InstrumentRunLog {
  _id: string;
  instrumentId: string;
  runType: string;
  qcStatus: "pass" | "fail" | "warning";
  downtimeMinutes: number;
  orderId?: string | null;
  accessionId?: string | null;
  sampleId?: string | null;
  slideId?: string | null;
  externalRunId?: string | null;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export type Hl7MessageDirection = "IN" | "OUT";

export type IntegrationProtocol = "HL7_MLLP" | "ASTM_ADAPTER" | "REST";

export type SpecimenWorkflowStatus =
  | "REGISTERED"
  | "GROSSING"
  | "PROCESSING"
  | "EMBEDDING"
  | "SECTIONING"
  | "STAINING"
  | "SCANNED"
  | "UNDER_REVIEW"
  | "REPORTED"
  | "ARCHIVED"
  | "CANCELLED"
  | "AMENDED";

export interface Hl7MessageRecord {
  _id: string;
  direction: Hl7MessageDirection;
  msgType: string;
  msgControlId: string;
  sendingApp?: string | null;
  sendingFacility?: string | null;
  receivingApp?: string | null;
  receivingFacility?: string | null;
  protocol: IntegrationProtocol;
  rawMessage: string;
  parsedOk: boolean;
  errorDetail?: string | null;
  ackCode?: string | null;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpecimenRecord {
  _id: string;
  sampleId?: string | null;
  accessionId?: string | null;
  orderId?: string | null;
  patientId?: string | null;
  patientExternalId: string;
  externalId?: string | null;
  instrumentId?: string | null;
  status: SpecimenWorkflowStatus;
  trackingStatus?: "idle" | "on_analyzer" | "off_analyzer";
  specimenType?: string | null;
  collectedAt?: string | null;
  sourceSystem?: string | null;
  lastHl7MessageControlId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpecimenStatusHistoryRecord {
  _id: string;
  specimenId: string;
  fromStatus?: SpecimenWorkflowStatus | null;
  toStatus: SpecimenWorkflowStatus;
  transitionedAt: string;
  sourceSystem?: string | null;
  hl7MsgId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResultRecord {
  _id: string;
  specimenId: string;
  orderId?: string | null;
  accessionId?: string | null;
  patientId?: string | null;
  testCode: string;
  testName?: string | null;
  value: string;
  units?: string | null;
  referenceRange?: string | null;
  abnormalFlag?: string | null;
  observationStatus?: string | null;
  observedAt?: string | null;
  hl7MsgId?: string | null;
  sourceSystem?: string | null;
  dataType?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpecimenImageRecord {
  _id: string;
  specimenId: string;
  orderId?: string | null;
  accessionId?: string | null;
  cassetteId?: string | null;
  slideLabel?: string | null;
  scannerId?: string | null;
  studyUid?: string | null;
  seriesUid?: string | null;
  wadoUrl: string;
  thumbnailUrl?: string | null;
  objective?: string | null;
  qualityScore?: number | null;
  scanTimestamp: string;
  hl7MsgId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VendorName = "leica" | "roche";

export type VendorDeviceType = "tissue_processor" | "stainer" | "scanner";

export type VendorConnectorStatus = "draft" | "ready" | "online" | "offline" | "error";

export type VendorAuthType = "none" | "api_key" | "bearer" | "basic";

export type VendorJobDirection = "outbound" | "inbound";

export type VendorJobType =
  | "case_sync"
  | "run_start"
  | "run_complete"
  | "stain_request"
  | "stain_complete"
  | "scan_request"
  | "scan_complete"
  | "status_poll"
  | "maintenance";

export type VendorJobStatus =
  | "queued"
  | "dispatched"
  | "acknowledged"
  | "completed"
  | "failed"
  | "cancelled";

export type VendorWebhookProcessingStatus = "received" | "processed" | "ignored" | "failed";

export interface VendorConnector {
  _id: string;
  name: string;
  vendor: VendorName;
  deviceType: VendorDeviceType;
  instrumentId?: string | null;
  integrationId?: string | null;
  siteId?: string | null;
  status: VendorConnectorStatus;
  enabled: boolean;
  liveMode: boolean;
  baseUrl: string;
  apiVersion: string;
  healthPath: string;
  dispatchPath: string;
  webhookPath: string;
  authType: VendorAuthType;
  authTokenEnvVar?: string | null;
  webhookSecretEnvVar?: string | null;
  externalDeviceId?: string | null;
  capabilities: string[];
  metadata: string;
  lastHeartbeatAt?: string | null;
  lastTestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VendorJob {
  _id: string;
  connectorId: string;
  vendor: VendorName;
  deviceType: VendorDeviceType;
  direction: VendorJobDirection;
  jobType: VendorJobType;
  status: VendorJobStatus;
  orderId?: string | null;
  accessionId?: string | null;
  sampleId?: string | null;
  slideId?: string | null;
  idempotencyKey: string;
  externalRequestId?: string | null;
  externalJobId?: string | null;
  requestPayload: string;
  responsePayload?: string | null;
  errorMessage?: string | null;
  requestedBy?: string | null;
  requestedAt: string;
  acknowledgedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VendorWebhookEvent {
  _id: string;
  connectorId?: string | null;
  vendor: VendorName;
  deviceType: VendorDeviceType;
  eventType: string;
  externalEventId?: string | null;
  signatureValidated: boolean;
  processingStatus: VendorWebhookProcessingStatus;
  orderId?: string | null;
  accessionId?: string | null;
  sampleId?: string | null;
  slideId?: string | null;
  payload: string;
  errorMessage?: string | null;
  receivedAt: string;
  processedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportTemplate {
  _id: string;
  name: string;
  reportType: "narrative" | "synoptic";
  body: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationLog {
  _id: string;
  orderId: string;
  channel: "email" | "sms" | "whatsapp" | "call" | "portal";
  recipient: string;
  message: string;
  status: "queued" | "sent" | "delivered" | "read" | "acknowledged";
  mandatory: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QualityEvent {
  _id: string;
  module: string;
  eventType: "qc" | "qa" | "capa" | "peer_review" | "audit" | "proficiency";
  status: "open" | "investigating" | "closed";
  summary: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

export interface TatAlert {
  _id: string;
  orderId?: string | null;
  phase: string;
  slaMinutes: number;
  actualMinutes: number;
  status: "on_track" | "risk" | "breach";
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveRecord {
  _id: string;
  entityType: "block" | "slide" | "case" | "sample";
  entityId: string;
  location: string;
  retentionUntil: string;
  status: "active" | "scheduled_disposal" | "disposed";
  createdAt: string;
  updatedAt: string;
}

export interface ReagentInventoryItem {
  _id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  reorderLevel: number;
  lotNumber: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface WasteLog {
  _id: string;
  category: string;
  quantity: number;
  disposalMethod: string;
  disposedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRecord {
  _id: string;
  title: string;
  category: string;
  version: string;
  owner: string;
  accessLevel: "controlled" | "training" | "public";
  trainingDueAt?: string | null;
  originalFilename?: string | null;
  storedFilename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  checksumSha256?: string | null;
  storageProvider?: "local" | "s3" | null;
  storagePath?: string | null;
  uploadedBy?: string | null;
  approvalStatus?: "draft" | "pending_review" | "approved" | "retired";
  approvedBy?: string | null;
  approvedAt?: string | null;
  approvalNotes?: string | null;
  trainingAttestations?: Array<{
    _id: string;
    userId: string;
    userName: string;
    attestedAt: string;
    version: string;
  }>;
  versions?: Array<{
    _id: string;
    version: string;
    originalFilename: string;
    storedFilename: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    storageProvider: "local" | "s3";
    storagePath: string;
    uploadedBy: string;
    uploadedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  _id: string;
  module: string;
  action: string;
  targetId: string;
  actor: string;
  actorUserId?: string | null;
  actorRole?: UserRole | null;
  siteId?: string | null;
  orderId?: string | null;
  requestId?: string | null;
  summary: string;
  metadata?: string | null;
  sequence: number;
  previousHash: string | null;
  hash: string;
  createdAt: string;
}

export interface ProjectReviewComment {
  _id: string;
  title: string;
  module: string;
  screen: string;
  severity: "low" | "medium" | "high" | "critical";
  comment: string;
  status: "new" | "reviewed" | "planned" | "in_progress" | "resolved" | "closed";
  createdByUserId: string;
  createdByName: string;
  createdByRole: UserRole;
  siteId?: string | null;
  developerResponse?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  _id: string;
  userId: string;
  email: string;
  role: UserRole;
  status: "active" | "expired" | "revoked";
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialAuditRecord {
  _id: string;
  userId: string;
  action: "login" | "password_change" | "mfa_update" | "session_revoked";
  outcome: "success" | "failure";
  createdAt: string;
}

export interface ValidationRule {
  _id: string;
  name: string;
  scope: "order" | "specimen" | "result" | "report" | "finance";
  severity: "info" | "warning" | "blocking";
  active: boolean;
  requiredFields: string[];
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface InternalChatThread {
  _id: string;
  title: string;
  department: string;
  participantUserIds: string[];
  createdBy: string;
  lastMessageAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InternalChatMessage {
  _id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  body: string;
  readBy: Array<{
    userId: string;
    readAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface OfflineSyncEvent {
  _id: string;
  clientId: string;
  syncType: "snapshot" | "mutation_batch" | "conflict" | "restore";
  status: "received" | "applied" | "partial" | "failed";
  payload: string;
  appliedCount: number;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalIntegration {
  _id: string;
  name: string;
  integrationType: "emr" | "his" | "accounting" | "ai" | "webhook";
  status: "configured" | "active" | "error";
  endpoint: string;
  lastEventAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PricingRule {
  _id: string;
  name: string;
  target: string;
  adjustmentType: "fixed" | "percent";
  adjustmentValue: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceRange {
  _id: string;
  testCode: string;
  population: string;
  range: string;
  units: string;
  createdAt: string;
  updatedAt: string;
}

export interface QcThreshold {
  _id: string;
  module: string;
  metric: string;
  warning: number;
  critical: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchDataset {
  _id: string;
  name: string;
  description: string;
  deIdentified: boolean;
  recordCount: number;
  pipelineStatus: "draft" | "ready" | "exported";
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryRecord {
  _id: string;
  recordType: "backup" | "restore" | "drill" | "sync";
  status: "scheduled" | "success" | "failure";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Site {
  _id: string;
  code: string;
  name: string;
  siteType: "hub" | "spoke" | "collection" | "lab";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SiteTransfer {
  _id: string;
  orderId: string;
  fromSiteId: string;
  toSiteId: string;
  status: "requested" | "in_transit" | "received";
  createdAt: string;
  updatedAt: string;
}

export interface ModuleAuditTarget {
  _id: string;
  moduleNumber: number;
  targetReleaseDate: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  _id: string;
  language: "english" | "french";
  locale: "en" | "fr";
  labName: string;
  tagline: string;
  aboutText: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  businessHours: string;
  timezone: string;
  dateFormat: string;
  currency: "USD" | "EUR" | "XAF";
  accreditations: string[];
  receptionistWorkflowSteps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Database {
  users: User[];
  doctors: Doctor[];
  patients: Patient[];
  testTypes: TestType[];
  hl7Messages: Hl7MessageRecord[];
  specimens: SpecimenRecord[];
  specimenStatusHistory: SpecimenStatusHistoryRecord[];
  resultRecords: ResultRecord[];
  specimenImages: SpecimenImageRecord[];
  orderNumberReservations: OrderNumberReservation[];
  orders: Order[];
  orderAmendments: OrderAmendment[];
  ocrIntakeJobs: OcrIntakeJob[];
  orderCorrections: OrderCorrection[];
  orderLocks: OrderLockRecord[];
  payments: Payment[];
  mavianceTransactions: MavianceTransaction[];
  insuranceAuthorizations: InsuranceAuthorization[];
  invoices: Invoice[];
  refunds: RefundAdjustment[];
  accountingAccounts: AccountingAccount[];
  accountingJournalEntries: AccountingJournalEntry[];
  accountingExportBatches: AccountingExportBatch[];
  zohoBooksSyncLogs: ZohoBooksSyncLog[];
  accessions: Accession[];
  samples: Sample[];
  barcodes: BarcodeRecord[];
  barcodeScanEvents: BarcodeScanEvent[];
  labelTemplates: LabelTemplateRecord[];
  chainOfCustody: ChainOfCustodyEvent[];
  preAnalyticsLogs: PreAnalyticsLog[];
  histologyWorklist: HistologyWorklistItem[];
  reports: Report[];
  reportTemplates: ReportTemplate[];
  cytologyCases: CytologyCase[];
  cytologyQualityRecords: CytologyQualityRecord[];
  antibodyInventory: AntibodyInventoryItem[];
  digitalSlides: DigitalSlideRecord[];
  aiResults: AiAnalysisResult[];
  instruments: InstrumentConnection[];
  instrumentRuns: InstrumentRunLog[];
  vendorConnectors: VendorConnector[];
  vendorJobs: VendorJob[];
  vendorWebhookEvents: VendorWebhookEvent[];
  workflowTemplates: WorkflowTemplate[];
  workflowHistory: WorkflowHistoryEntry[];
  notifications: Notification[];
  communicationLogs: CommunicationLog[];
  qualityEvents: QualityEvent[];
  tatAlerts: TatAlert[];
  archiveRecords: ArchiveRecord[];
  reagentInventory: ReagentInventoryItem[];
  wasteLogs: WasteLog[];
  documents: DocumentRecord[];
  auditEvents: AuditEvent[];
  projectReviewComments: ProjectReviewComment[];
  sessionRecords: SessionRecord[];
  credentialAudits: CredentialAuditRecord[];
  validationRules: ValidationRule[];
  internalChatThreads: InternalChatThread[];
  internalChatMessages: InternalChatMessage[];
  offlineSyncEvents: OfflineSyncEvent[];
  integrations: ExternalIntegration[];
  pricingRules: PricingRule[];
  referenceRanges: ReferenceRange[];
  qcThresholds: QcThreshold[];
  researchDatasets: ResearchDataset[];
  recoveryRecords: RecoveryRecord[];
  sites: Site[];
  siteTransfers: SiteTransfer[];
  moduleAuditTargets: ModuleAuditTarget[];
  settings: Settings;
}
