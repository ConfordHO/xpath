export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'receptionist'
  | 'technician'
  | 'pathologist'
  | 'doctor'
  | 'finance'
  | 'courier'

export type OrderStatus =
  | 'draft'
  | 'received'
  | 'in_progress'
  | 'review'
  | 'completed'
  | 'released'
  | 'cancelled'

export type CourierStatus =
  | ''
  | 'ready_for_pickup'
  | 'on_way_to_pickup'
  | 'at_site_for_pickup'
  | 'picked_up_on_way_to_lab'
  | 'in_transit'
  | 'received_at_lab'

export type OrderWorkflowStageId =
  | 'accessioning'
  | 'grossing'
  | 'processing'
  | 'embedding'
  | 'sectioning'
  | 'staining'
  | 'cytology_case'
  | 'cytology_screening'
  | 'cytology_qc'
  | 'ihc'
  | 'analyzer_run'
  | 'molecular_sendout'
  | 'pathologist_review'
  | 'report_signout'
  | 'result_release'

export type OrderWorkflowModule =
  | 'histology'
  | 'cytology'
  | 'ihc'
  | 'analyzer'
  | 'molecular'
  | 'pathology'

export interface OrderWorkflowStageState {
  id: OrderWorkflowStageId
  label: string
  description: string
  module: OrderWorkflowModule
  status: 'complete' | 'current' | 'pending' | 'blocked'
}

export type OrderItemStatus =
  | 'pending'
  | 'blocked'
  | 'in_progress'
  | 'completed'
  | 'released'
  | 'cancelled'
  | 'resolved'

export interface OrderWorkflowDependency {
  code: string
  label: string
  status: 'satisfied' | 'pending' | 'blocked'
  message: string
  dependsOnOrderItemIds: string[]
  satisfiedByStageId?: OrderWorkflowStageId | null
}

export interface OrderWorkflowSpecimenLink {
  specimenId: string
  accessionId?: string | null
  sampleId?: string | null
  label: string
  sharedWithOrderItemIds: string[]
}

export interface OrderWorkflowItemSummary {
  pending: number
  blocked: number
  inProgress: number
  completed: number
  released: number
  cancelled: number
  resolved: number
}

export interface OrderWorkflowItemPlan {
  orderItemId: string
  itemNumber: number
  testTypeId: string
  testCode: string
  testName: string
  category: string
  status: OrderItemStatus
  terminal: boolean
  routeTags: string[]
  nextStageId: OrderWorkflowStageId | null
  nextStageLabel: string | null
  nextModule: OrderWorkflowModule | null
  reviewReady: boolean
  dependencies: OrderWorkflowDependency[]
  specimenLinks: OrderWorkflowSpecimenLink[]
  stages: OrderWorkflowStageState[]
}

export interface OrderWorkflowPlan {
  summary: string
  routeTags: string[]
  requiresTechnician: boolean
  nextStageId: OrderWorkflowStageId | null
  nextStageLabel: string | null
  nextModule: OrderWorkflowModule | null
  reviewReady: boolean
  itemSummary: OrderWorkflowItemSummary
  itemPlans: OrderWorkflowItemPlan[]
  stages: OrderWorkflowStageState[]
}

export interface OrderWorkflowRouteGuide {
  key: string
  orderItemId: string
  testTypeId: string
  testCode: string
  testName: string
  category: string
  status: OrderItemStatus
  stages: OrderWorkflowStageId[]
  routeTags: string[]
  requiresAccession: boolean
  primaryModule: OrderWorkflowModule
  dependencies: OrderWorkflowDependency[]
  specimenLinks: OrderWorkflowSpecimenLink[]
}

export interface OrderVisibilityBlocker {
  code: string
  ownerRole: string
  title: string
  message: string
}

export interface SafeUser {
  _id: string
  email: string
  name: string
  role: UserRole
  preferredLanguage: 'english' | 'french'
  preferredLocale: 'en' | 'fr'
  siteId?: string | null
  active: boolean
  mfaEnabled?: boolean
  mfaVerifiedAt?: string | null
  failedLoginCount?: number
  lockedUntil?: string | null
  createdAt: string
  updatedAt: string
}

export interface Patient {
  _id: string
  firstName: string
  lastName: string
  dateOfBirth: string
  gender: 'male' | 'female' | 'other'
  phone: string
  email: string
  address: string
  siteId?: string | null
  externalPatientId?: string | null
  authorizedDoctorIds?: string[]
  nationalId?: string
  anonymized?: boolean
  anonymousLabel?: string | null
  createdAt: string
  updatedAt: string
}

export interface TestType {
  _id: string
  code: string
  name: string
  description?: string
  category: string
  price: number
  turnaroundHours?: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface Doctor {
  _id: string
  name: string
  code: string
  type: 'doctor' | 'clinic'
  email: string
  phone: string
  active: boolean
  siteId?: string | null
  user?: {
    _id: string
    email: string
    name: string
  } | null
  createdAt: string
  updatedAt: string
}

export interface Payment {
  _id: string
  orderId: string
  amount: number
  method:
    | 'cash'
    | 'card'
    | 'mobile_money'
    | 'bank_transfer'
    | 'mtn_mobile_money'
    | 'orange_money'
    | 'transfer'
    | 'other'
  status: 'pending' | 'completed' | 'failed'
  provider?: 'manual' | 'maviance'
  providerChannel?: 'mtn_cameroon' | 'orange_cameroon' | null
  providerStatus?: string | null
  providerErrorCode?: string | null
  providerTransactionNumber?: string | null
  providerTransactionReference?: string | null
  gatewayReference?: string | null
  receiptNumber?: string | null
  verificationCode?: string | null
  createdAt: string
  updatedAt: string
  confirmedWithPatientAt?: string | null
}

export interface MavianceGatewayConfig {
  enabled: boolean
  credentialsConfigured: boolean
  webhookConfigured: boolean
  baseUrl: string
  apiVersion: string
  requestFormat: 'form' | 'json'
  channels: Array<{
    channel: 'mtn_cameroon' | 'orange_cameroon'
    label: string
    merchantCode: string | null
    serviceId: string | null
    payItemId: string | null
    configured: boolean
  }>
}

export interface MavianceTransaction {
  _id: string
  orderId: string
  paymentId?: string | null
  siteId?: string | null
  channel: 'mtn_cameroon' | 'orange_cameroon'
  merchantCode: string
  serviceId: string
  payItemId?: string | null
  quoteId?: string | null
  amount: number
  currency: 'XAF'
  customerPhone: string
  customerEmail: string
  customerName?: string | null
  customerAddress?: string | null
  customerNumber?: string | null
  serviceNumber?: string | null
  tag?: string | null
  cdata?: string | null
  ptn?: string | null
  receiptNumber?: string | null
  verificationCode?: string | null
  externalTransactionId?: string | null
  providerStatus: string
  normalizedStatus:
    | 'quote_created'
    | 'collection_requested'
    | 'pending'
    | 'success'
    | 'errored'
    | 'reversed'
    | 'under_investigation'
  errorCode?: string | null
  errorMessage?: string | null
  callbackDeliveryId?: string | null
  callbackSignatureValidated?: boolean
  liveMode: boolean
  quotePayload?: string | null
  collectPayload?: string | null
  verifyPayload?: string | null
  createdAt: string
  updatedAt: string
  quotedAt?: string | null
  collectedAt?: string | null
  verifiedAt?: string | null
  settledAt?: string | null
}

export interface Slide {
  _id: string
  slideId: string
  stainStatus: 'pending' | 'stained'
  stainType: string
  stainedAt?: string | null
  imageUrls: string[]
  ihcEntries: Array<{
    _id: string
    antibody: string
    clone: string
    antigenRetrieval: string
    detection: string
    counterstain: string
    qcNotes?: string
    createdAt: string
  }>
  blockId?: string
}

export interface Accession {
  _id: string
  accessionId: string
  orderId: string
  receivedAt: string
  receivedBy: string
  numberOfBlocks: number
  grossDescription?: string
  grossedAt?: string | null
  grossedBy?: string | null
  processingNotes?: string
  processedAt?: string | null
  embeddedAt?: string | null
  sectionedAt?: string | null
  stainedAt?: string | null
  blocks: Array<{
    _id: string
    blockId: string
    embeddedAt?: string | null
    sectionedAt?: string | null
    slides: Slide[]
  }>
}

export interface Report {
  _id: string
  orderId: string
  accessionId?: string | null
  status: 'draft' | 'complete'
  diagnosis: string
  microscopicDescription: string
  grossDescription: string
  comment: string
  emailedAt?: string | null
  lockedAt?: string | null
  authorId?: string | null
  templateId?: string | null
  signedBy?: string | null
  signedAt?: string | null
  releaseRuleStatus?: 'pending' | 'ready' | 'released'
  versions?: Array<{
    version: number
    diagnosis: string
    microscopicDescription: string
    comment: string
    createdAt: string
  }>
  addenda?: Array<{
    _id: string
    note: string
    authorId: string
    createdAt: string
  }>
  createdAt: string
  updatedAt: string
}

export interface CytologyCase {
  _id: string
  orderId: string
  caseNumber: string
  specimenType: string
  status: 'open' | 'screening' | 'review' | 'escalated' | 'complete'
  remarks: string
  routeType?: 'gyn' | 'non_gyn'
  preparationType?: 'smear' | 'cell_block' | 'liquid_based'
  qcStatus?: 'pending' | 'pass' | 'fail'
  qcNotes?: string
  screeningStatus?: 'pending' | 'in_progress' | 'adequate' | 'inadequate' | 'escalated'
  adequacyStatus?: 'pending' | 'satisfactory' | 'limited' | 'unsatisfactory'
  adequacyCriteriaMet?: string[]
  adequacyExceptions?: string[]
  cytotechnologistId?: string | null
  screenedAt?: string | null
  pathologistEscalatedAt?: string | null
  pathologistEscalationReason?: string | null
  bethesdaCategory?: string | null
  screeningNotes?: string | null
  createdAt: string
  updatedAt: string
}

export interface HydratedOrder {
  _id: string
  orderNumber: string
  patient: Patient
  testTypes: TestType[]
  workflowPlan: OrderWorkflowPlan
  workflowRoutes: OrderWorkflowRouteGuide[]
  blockers: OrderVisibilityBlocker[]
  status: OrderStatus
  priority: 'normal' | 'urgent'
  referringDoctor: string | null
  referringDoctorId:
    | {
        _id: string
        name: string
        code: string
        type: string
      }
    | null
  payerType?: 'patient' | 'clinician' | 'corporate' | 'insurance' | 'lab_policy'
  billingAccountName?: string | null
  billingInstructions?: string | null
  assignedTechnician?:
    | {
        _id: string
        email: string
        name: string
        role: UserRole
      }
    | null
  assignedPathologist?:
    | {
        _id: string
        email: string
        name: string
        role: UserRole
      }
    | null
  createdBy: string
  courierStatus: CourierStatus
  orderSource: 'walk_in' | 'online' | 'referral'
  notes?: string
  clinicalHistory?: string
  validationStatus?: 'pending' | 'validated' | 'rejected'
  validationNotes?: string
  intakeSource?: 'manual' | 'portal' | 'ocr_nlp'
  financialClearance?: 'pending' | 'cleared' | 'blocked'
  siteId?: string | null
  cancelledAt?: string | null
  cancellationReason?: string | null
  pickupAddress?: string | null
  pickupPlaceName?: string | null
  pickupLat?: number | null
  pickupLng?: number | null
  receivedAt?: string | null
  receivedByUserId?: string | null
  courierCheckedInAt?: string | null
  courierReceivedAt?: string | null
  triagedAt?: string | null
  triagedBy?: string | null
  workflowReleasedAt?: string | null
  workflowReleasedBy?: string | null
  paymentCollectionStatus?:
    | 'unpaid'
    | 'cash_with_courier'
    | 'paid_online'
    | 'payment_prompt_sent'
    | 'cash_received_at_reception'
    | 'reconciled'
  paymentCollectionMethod?:
    | 'cash'
    | 'card'
    | 'mobile_money'
    | 'bank_transfer'
    | 'mtn_mobile_money'
    | 'orange_money'
    | 'transfer'
    | 'other'
    | null
  paymentCollectionAmount?: number | null
  paymentCollectionReference?: string | null
  paymentCollectionDeclaredBy?: string | null
  paymentCollectionDeclaredAt?: string | null
  paymentPromptSentAt?: string | null
  paymentPromptRecipient?: string | null
  anonymousCaseCode?: string | null
  requesterNotificationEmail?: string | null
  requesterNotificationPhone?: string | null
  completedAt?: string | null
  releasedAt?: string | null
  lockStatus?: 'unlocked' | 'locked'
  lockedAt?: string | null
  lockedBy?: string | null
  lockReason?: string | null
  reportSummary?: string | null
  pathologistDiagnosis?: string | null
  createdAt: string
  updatedAt: string
}

export interface ApprovalRecord {
  userId: string
  userName: string
  role: UserRole
  approvedAt: string
}

export interface Sample {
  _id: string
  accessionId: string
  orderId: string
  label: string
  type: string
  status: string
  location?: string
  barcodeId?: string | null
  parentSampleId?: string | null
  rejectionReason?: string | null
  discrepancyFlag?: boolean
  storageLocation?: string | null
  receivedAt: string
  createdAt: string
  updatedAt: string
  order?: HydratedOrder
}

export interface OrderAmendment {
  _id: string
  orderId: string
  type: 'amendment' | 'add_on' | 'cancellation'
  reason: string
  details: string
  createdBy: string
  status?: 'pending' | 'approved' | 'rejected' | 'applied'
  policyLevel?: 'standard' | 'controlled' | 'legal'
  requiredApprovals?: number
  approvals?: ApprovalRecord[]
  rejectedBy?: string | null
  rejectedAt?: string | null
  rejectionReason?: string | null
  appliedBy?: string | null
  appliedAt?: string | null
  beforeSnapshot?: string | null
  afterSnapshot?: string | null
  createdAt: string
  updatedAt?: string
}

export interface OcrIntakeJob {
  _id: string
  source: 'upload' | 'manual_text'
  originalFilename?: string | null
  mimeType?: string | null
  rawText: string
  parsedPayload: string | {
    patient: Patient
    clinicalHistory: string
    testTypeIds: string[]
    matchedTestCodes: string[]
  }
  confidence: number
  fieldConfidences: string | Record<string, number>
  status: 'needs_verification' | 'verified' | 'rejected' | 'converted_to_order'
  requiredHumanVerification: boolean
  verificationNotes?: string | null
  verifiedBy?: string | null
  verifiedAt?: string | null
  convertedOrderId?: string | null
  createdBy: string
  siteId?: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderCorrection {
  _id: string
  orderId: string
  reason: string
  changes: string
  status: 'pending' | 'approved' | 'rejected' | 'applied'
  requiredApprovals: number
  approvals: ApprovalRecord[]
  requestedBy: string
  rejectedBy?: string | null
  rejectedAt?: string | null
  rejectionReason?: string | null
  appliedBy?: string | null
  appliedAt?: string | null
  beforeSnapshot: string
  afterSnapshot?: string | null
  createdAt: string
  updatedAt: string
}

export interface InsuranceAuthorization {
  _id: string
  orderId: string
  payerName: string
  policyNumber: string
  preAuthCode: string
  status: 'pending' | 'approved' | 'denied'
  approvedAmount: number
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface Invoice {
  _id: string
  orderId: string
  invoiceNumber: string
  subtotal: number
  adjustmentAmount: number
  total: number
  status: 'draft' | 'issued' | 'unpaid' | 'partial' | 'paid' | 'refunded'
  paymentGateway: 'cash' | 'card' | 'maviance' | 'bank_transfer' | 'insurance'
  issuedAt: string
  createdAt: string
  updatedAt: string
}

export interface RefundAdjustment {
  _id: string
  orderId: string
  invoiceId?: string | null
  type: 'refund' | 'adjustment'
  amount: number
  reason: string
  status: 'pending' | 'approved' | 'completed' | 'rejected'
  createdBy?: string | null
  requiredApprovals?: number
  approvals?: ApprovalRecord[]
  approvedBy?: string | null
  approvedAt?: string | null
  rejectedBy?: string | null
  rejectedAt?: string | null
  rejectionReason?: string | null
  completedBy?: string | null
  completedAt?: string | null
  reversalJournalEntryId?: string | null
  createdAt: string
  updatedAt: string
}

export interface BarcodeRecord {
  _id: string
  code: string
  symbology: 'gs1_128' | 'qr' | 'code128'
  entityType: 'specimen' | 'block' | 'slide' | 'case'
  entityId?: string | null
  status: 'unassigned' | 'assigned' | 'printed' | 'archived'
  templateId?: string | null
  justification?: string
  printedAt?: string | null
  assignedAt?: string | null
  assignedBy?: string | null
  archivedAt?: string | null
  archivedBy?: string | null
  lastScannedAt?: string | null
  gs1ApplicationIdentifiers?: Record<string, string> | null
  createdAt: string
  updatedAt: string
}

export interface LabelTemplateRecord {
  _id: string
  name: string
  printerName: string
  templateType: 'specimen' | 'block' | 'slide' | 'case'
  scanEnforced: boolean
  requireGs1?: boolean
  createdAt: string
  updatedAt: string
}

export interface ChainOfCustodyEvent {
  _id: string
  specimenId: string
  eventType: 'collected' | 'picked_up' | 'received' | 'aliquoted' | 'transferred' | 'handoff' | 'rejected' | 'exception' | 'temperature_logged'
  location: string
  condition: string
  actor: string
  handedOffTo?: string | null
  gpsLat?: number | null
  gpsLng?: number | null
  temperatureCelsius?: number | null
  notes?: string
  createdAt: string
}

export interface PreAnalyticsLog {
  _id: string
  orderId: string
  specimenId?: string | null
  collectionAt: string
  pickupAt?: string | null
  receiptAt?: string | null
  transportTemperature: string
  transportCondition: string
  receiptValidated: boolean
  receiptException?: string | null
  validatedBy?: string | null
  validatedAt?: string | null
  tatMinutes: number
  createdAt: string
  updatedAt: string
}

export interface HistologyWorklistItem {
  _id: string
  accessionId: string
  taskType: 'grossing' | 'processing' | 'embedding' | 'sectioning' | 'staining' | 'recut' | 'special_stain'
  status: 'pending' | 'in_progress' | 'complete'
  assignedTo?: string | null
  assignedBy?: string | null
  assignedAt?: string | null
  completedBy?: string | null
  completedAt?: string | null
  queuePriority?: 'routine' | 'urgent' | 'stat'
  workloadWeight?: number
  ownershipAuditId?: string | null
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface CytologyQualityRecord {
  _id: string
  cytologyCaseId: string
  routeType: 'gyn' | 'non_gyn'
  preparationType: 'smear' | 'cell_block' | 'liquid_based'
  qcStatus: 'pending' | 'pass' | 'fail'
  qcNotes: string
  adequacyStatus?: 'pending' | 'satisfactory' | 'limited' | 'unsatisfactory'
  adequacyScore?: number | null
  unsatisfactoryReason?: string | null
  trendBucket?: string | null
  createdAt: string
  updatedAt: string
}

export interface AntibodyInventoryItem {
  _id: string
  antibody: string
  clone: string
  lotNumber: string
  quantity: number
  unit: string
  expiresAt: string
  controlSlideTracked: boolean
  qcStatus: 'pass' | 'hold' | 'fail'
  usageCount: number
  batchReleaseStatus?: 'pending' | 'released' | 'held' | 'rejected'
  releasedBy?: string | null
  releasedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface DigitalSlideRecord {
  _id: string
  orderId: string
  slideId: string
  scannerVendor: string
  metadata: string
  viewerUrl: string
  connectorId?: string | null
  externalCaseId?: string | null
  externalSlideId?: string | null
  scanStatus?: 'requested' | 'scanning' | 'available' | 'failed'
  scannedAt?: string | null
  ownerId?: string | null
  ownerLockedAt?: string | null
  ownerLockReason?: string | null
  signOutLockedBy?: string | null
  signOutLockedAt?: string | null
  signOutLockReason?: string | null
  signOutStatus: 'pending' | 'reviewed' | 'signed_out'
  createdAt: string
  updatedAt: string
}

export interface AiAnalysisResult {
  _id: string
  slideId: string
  analysisType: 'qc' | 'ki67' | 'ihc_scoring' | 'tumor_detection'
  version: string
  score: string
  explainability: string
  status: 'pending' | 'accepted' | 'rejected'
  modelId?: string | null
  validationStatus?: 'research_only' | 'site_validation_required' | 'clinically_validated'
  clinicalUseAllowed?: boolean
  providerPayload?: string | null
  createdAt: string
  updatedAt: string
}

export interface InstrumentConnection {
  _id: string
  name: string
  vendor?: string | null
  instrumentType?: string | null
  protocol: 'HL7' | 'FHIR' | 'REST'
  status: 'online' | 'offline' | 'degraded'
  siteId?: string | null
  externalDeviceId?: string | null
  lastSyncAt?: string | null
  lastHeartbeatAt?: string | null
  bidirectional: boolean
  createdAt: string
  updatedAt: string
}

export interface InstrumentRunLog {
  _id: string
  instrumentId: string
  runType: string
  qcStatus: 'pass' | 'fail' | 'warning'
  downtimeMinutes: number
  orderId?: string | null
  accessionId?: string | null
  sampleId?: string | null
  slideId?: string | null
  externalRunId?: string | null
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export type VendorName = 'leica' | 'roche'

export type VendorDeviceType = 'tissue_processor' | 'stainer' | 'scanner'

export type VendorConnectorStatus = 'draft' | 'ready' | 'online' | 'offline' | 'error'

export type VendorAuthType = 'none' | 'api_key' | 'bearer' | 'basic'

export type VendorJobDirection = 'outbound' | 'inbound'

export type VendorJobType =
  | 'case_sync'
  | 'run_start'
  | 'run_complete'
  | 'stain_request'
  | 'stain_complete'
  | 'scan_request'
  | 'scan_complete'
  | 'status_poll'
  | 'maintenance'

export type VendorJobStatus =
  | 'queued'
  | 'dispatched'
  | 'acknowledged'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type VendorWebhookProcessingStatus = 'received' | 'processed' | 'ignored' | 'failed'

export interface VendorConnector {
  _id: string
  name: string
  vendor: VendorName
  deviceType: VendorDeviceType
  instrumentId?: string | null
  integrationId?: string | null
  siteId?: string | null
  status: VendorConnectorStatus
  enabled: boolean
  liveMode: boolean
  baseUrl: string
  apiVersion: string
  healthPath: string
  dispatchPath: string
  webhookPath: string
  authType: VendorAuthType
  authTokenEnvVar?: string | null
  webhookSecretEnvVar?: string | null
  externalDeviceId?: string | null
  capabilities: string[]
  metadata: string
  lastHeartbeatAt?: string | null
  lastTestedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface VendorJob {
  _id: string
  connectorId: string
  vendor: VendorName
  deviceType: VendorDeviceType
  direction: VendorJobDirection
  jobType: VendorJobType
  status: VendorJobStatus
  orderId?: string | null
  accessionId?: string | null
  sampleId?: string | null
  slideId?: string | null
  idempotencyKey: string
  externalRequestId?: string | null
  externalJobId?: string | null
  requestPayload: string
  responsePayload?: string | null
  errorMessage?: string | null
  requestedBy?: string | null
  requestedAt: string
  acknowledgedAt?: string | null
  completedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface VendorWebhookEvent {
  _id: string
  connectorId?: string | null
  vendor: VendorName
  deviceType: VendorDeviceType
  eventType: string
  externalEventId?: string | null
  signatureValidated: boolean
  processingStatus: VendorWebhookProcessingStatus
  orderId?: string | null
  accessionId?: string | null
  sampleId?: string | null
  slideId?: string | null
  payload: string
  errorMessage?: string | null
  receivedAt: string
  processedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ReportTemplateRecord {
  _id: string
  name: string
  reportType: 'narrative' | 'synoptic'
  body: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CommunicationLog {
  _id: string
  orderId: string
  channel: 'email' | 'sms' | 'whatsapp' | 'call' | 'portal'
  recipient: string
  message: string
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'acknowledged'
  mandatory: boolean
  createdAt: string
  updatedAt: string
}

export interface QualityEvent {
  _id: string
  module: string
  eventType: 'qc' | 'qa' | 'capa' | 'peer_review' | 'audit' | 'proficiency'
  status: 'open' | 'investigating' | 'closed'
  summary: string
  owner: string
  linkedOrderId?: string | null
  linkedSampleId?: string | null
  linkedDiscrepancyId?: string | null
  rootCause?: string | null
  correctiveAction?: string | null
  preventiveAction?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface TatAlert {
  _id: string
  orderId?: string | null
  phase: string
  slaMinutes: number
  actualMinutes: number
  status: 'on_track' | 'risk' | 'breach'
  escalatedToRole?: UserRole | null
  escalatedAt?: string | null
  notificationId?: string | null
  createdAt: string
  updatedAt: string
}

export interface ArchiveRecord {
  _id: string
  entityType: 'block' | 'slide' | 'case' | 'sample'
  entityId: string
  location: string
  retentionUntil: string
  status: 'active' | 'scheduled_disposal' | 'disposed'
  createdAt: string
  updatedAt: string
}

export interface ReagentInventoryItem {
  _id: string
  name: string
  category: string
  quantity: number
  unit: string
  reorderLevel: number
  lotNumber: string
  expiresAt: string
  batchReleaseStatus?: 'pending' | 'released' | 'held' | 'rejected'
  releasedBy?: string | null
  releasedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface SampleDiscrepancyCase {
  _id: string
  sampleId: string
  orderId: string
  discrepancyType: 'identity_mismatch' | 'unlabeled' | 'leaking_container' | 'insufficient_volume' | 'temperature_excursion' | 'transport_delay' | 'wrong_container' | 'missing_requisition' | 'other'
  severity: 'minor' | 'major' | 'critical'
  description: string
  immediateAction: 'quarantine' | 'reject' | 'accept_with_deviation' | 'request_recollection'
  status: 'open' | 'awaiting_approval' | 'approved' | 'rejected' | 'closed'
  createdBy: string
  approvals: Array<{ userId: string; role: UserRole; decision: 'approve' | 'reject'; comment: string; decidedAt: string }>
  requiredApprovals: number
  capaEventId?: string | null
  correctiveAction?: string | null
  closedBy?: string | null
  closedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface CourierProviderEvent {
  _id: string
  orderId: string
  provider: string
  providerJobId?: string | null
  eventType: 'dispatch_requested' | 'accepted' | 'enroute' | 'picked_up' | 'delivered' | 'cancelled' | 'failed'
  payload?: string | null
  status: 'pending' | 'sent' | 'received' | 'failed'
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
}

export interface TemperatureLogRecord {
  _id: string
  orderId?: string | null
  sampleId?: string | null
  courierEventId?: string | null
  deviceId: string
  provider: string
  temperatureCelsius: number
  humidityPercent?: number | null
  recordedAt: string
  receivedAt: string
  withinRange: boolean
  rangeMinCelsius?: number | null
  rangeMaxCelsius?: number | null
  payload?: string | null
  createdAt: string
}

export interface SpecialStainRequest {
  _id: string
  orderId: string
  accessionId: string
  slideId: string
  requestType: 'recut' | 'special_stain' | 'ihc'
  stainName: string
  reason: string
  status: 'requested' | 'approved' | 'rejected' | 'in_progress' | 'completed' | 'qc_failed'
  requestedBy: string
  approvedBy?: string | null
  approvedAt?: string | null
  rejectedBy?: string | null
  rejectedAt?: string | null
  rejectionReason?: string | null
  controlSlideStatus?: 'pending' | 'pass' | 'fail' | null
  lotNumber?: string | null
  billingReference?: string | null
  inventoryDrawdowns?: Array<{ inventoryId: string; name: string; quantity: number; unit: string }>
  completedBy?: string | null
  completedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface AiModelRegistryRecord {
  _id: string
  name: string
  provider: 'local' | 'external'
  version: string
  analysisTypes: AiAnalysisResult['analysisType'][]
  validationStatus: 'research_only' | 'site_validation_required' | 'clinically_validated'
  clinicalUseAllowed: boolean
  regulatoryReference?: string | null
  endpointEnvVar?: string | null
  apiKeyEnvVar?: string | null
  lastValidationAt?: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

export interface WasteLog {
  _id: string
  category: string
  quantity: number
  disposalMethod: string
  disposedAt: string
  createdAt: string
  updatedAt: string
}

export interface DocumentRecord {
  _id: string
  title: string
  category: string
  version: string
  owner: string
  accessLevel: 'controlled' | 'training' | 'public'
  trainingDueAt?: string | null
  originalFilename?: string | null
  storedFilename?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  checksumSha256?: string | null
  storageProvider?: 'local' | 's3' | null
  storagePath?: string | null
  uploadedBy?: string | null
  versions?: Array<{
    _id: string
    version: string
    originalFilename: string
    storedFilename: string
    mimeType: string
    sizeBytes: number
    checksumSha256: string
    storageProvider: 'local' | 's3'
    storagePath: string
    uploadedBy: string
    uploadedAt: string
  }>
  createdAt: string
  updatedAt: string
}

export interface AuditEvent {
  _id: string
  module: string
  action: string
  targetId: string
  actor: string
  actorUserId?: string | null
  actorRole?: UserRole | null
  siteId?: string | null
  orderId?: string | null
  requestId?: string | null
  summary: string
  metadata?: string | null
  sequence: number
  previousHash: string | null
  hash: string
  createdAt: string
}

export interface ProjectReviewComment {
  _id: string
  title: string
  module: string
  screen: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  comment: string
  status: 'new' | 'reviewed' | 'planned' | 'in_progress' | 'resolved' | 'closed'
  createdByUserId: string
  createdByName: string
  createdByRole: UserRole
  siteId?: string | null
  developerResponse?: string | null
  resolvedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface SessionRecord {
  _id: string
  userId: string
  email: string
  role: UserRole
  status: 'active' | 'expired' | 'revoked'
  ipAddress: string
  userAgent: string
  createdAt: string
  updatedAt: string
}

export interface CredentialAuditRecord {
  _id: string
  userId: string
  action: 'login' | 'password_change' | 'mfa_update' | 'session_revoked'
  outcome: 'success' | 'failure'
  createdAt: string
}

export interface ExternalIntegration {
  _id: string
  name: string
  integrationType: 'emr' | 'his' | 'accounting' | 'ai' | 'webhook'
  status: 'configured' | 'active' | 'error'
  endpoint: string
  lastEventAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface PricingRule {
  _id: string
  name: string
  target: string
  adjustmentType: 'fixed' | 'percent'
  adjustmentValue: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface ReferenceRange {
  _id: string
  testCode: string
  population: string
  range: string
  units: string
  createdAt: string
  updatedAt: string
}

export interface QcThreshold {
  _id: string
  module: string
  metric: string
  warning: number
  critical: number
  createdAt: string
  updatedAt: string
}

export interface ResearchDataset {
  _id: string
  name: string
  description: string
  deIdentified: boolean
  recordCount: number
  pipelineStatus: 'draft' | 'ready' | 'exported'
  createdAt: string
  updatedAt: string
}

export interface RecoveryRecord {
  _id: string
  recordType: 'backup' | 'restore' | 'drill' | 'sync'
  status: 'scheduled' | 'success' | 'failure'
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Site {
  _id: string
  code: string
  name: string
  siteType: 'hub' | 'spoke' | 'collection' | 'lab'
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface SiteTransfer {
  _id: string
  orderId: string
  fromSiteId: string
  toSiteId: string
  status: 'requested' | 'in_transit' | 'received'
  createdAt: string
  updatedAt: string
}

export interface ModuleAuditEntry {
  number: number
  title: string
  status: string
  productionReady: boolean
  productionReadiness?: 'Code ready' | 'Code and external integration' | 'External integration' | string
  notes: string
  targetReleaseDate?: string | null
}

export interface TatSummary {
  averagePreAnalyticsMinutes: number
  riskCount: number
  breachCount: number
  openAlerts: TatAlert[]
}

export interface Settings {
  _id: string
  language: 'english' | 'french'
  locale: 'en' | 'fr'
  labName: string
  tagline: string
  aboutText: string
  contactEmail: string
  contactPhone: string
  address: string
  businessHours: string
  timezone: string
  dateFormat: string
  currency: 'USD' | 'EUR' | 'XAF'
  accreditations: string[]
  receptionistWorkflowSteps: string[]
  createdAt: string
  updatedAt: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  steps: string[]
}

export interface WorkflowHistoryEntry {
  _id: string
  workflowTemplateId: string
  workflowTemplateName: string
  orderId?: string
  patientName?: string
  completedAt: string
  notes?: string
}

export interface NotificationEntry {
  _id: string
  title: string
  body: string
  read: boolean
  audienceRoles?: UserRole[] | null
  audienceUserIds?: string[] | null
  siteId?: string | null
  createdAt: string
  updatedAt?: string
}

export interface DashboardSummary {
  totalOrders: number
  reviewOrders: number
  pendingPickup: number
  readyReports: number
  workflowItems: OrderWorkflowItemSummary & { total: number }
  latestOrders: HydratedOrder[]
  countsByStatus: Record<string, number>
}

export interface FinanceSummary {
  totalRevenue: number
  totalRevenueDisplay: string
  completedPayments: number
  pendingPayments: number
  transactions: Array<
    Payment & {
      order: HydratedOrder
      amountDisplay: string
    }
  >
  paymentsByMethod: Record<
    'cash' | 'card' | 'mobile_money' | 'bank_transfer' | 'mtn_mobile_money' | 'orange_money' | 'transfer' | 'other',
    number
  >
}

export interface FinanceMonthlyDashboard {
  currency: 'USD' | 'EUR' | 'XAF'
  rows: Array<{
    month: string
    grossRevenue: number
    refunds: number
    netRevenue: number
    invoiceTotal: number
    paymentCount: number
    invoiceCount: number
    display: string
  }>
  totals: {
    grossRevenue: number
    refunds: number
    netRevenue: number
  }
}

export interface ZohoBooksSyncLog {
  _id: string
  entityType: 'oauth' | 'organization' | 'contact' | 'invoice' | 'payment' | 'refund'
  entityId?: string | null
  orderId?: string | null
  provider: 'zoho_books'
  operation:
    | 'authorize_url'
    | 'token_exchange'
    | 'list_organizations'
    | 'sync_contact'
    | 'sync_invoice'
    | 'sync_payment'
    | 'sync_refund'
  status: 'queued' | 'success' | 'failed'
  externalId?: string | null
  endpoint: string
  requestPayload?: string | null
  responsePayload?: string | null
  errorMessage?: string | null
  siteId?: string | null
  syncedBy?: string | null
  syncedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ZohoBooksConfig {
  enabled: boolean
  clientConfigured: boolean
  redirectConfigured: boolean
  refreshTokenConfigured: boolean
  organizationConfigured: boolean
  accountsBaseUrl: string
  apiBaseUrl: string
  organizationId: string | null
  requiredEnv: string[]
}

export interface ZohoBooksOrganization {
  organization_id: string
  name: string
  country?: string
  currency_code?: string
  time_zone?: string
}

export interface AccountingJournalEntry {
  _id: string
  entryNumber: string
  orderId?: string | null
  invoiceId?: string | null
  paymentId?: string | null
  refundId?: string | null
  entryType: 'invoice' | 'payment' | 'refund' | 'adjustment' | 'export'
  debitAccount: string
  creditAccount: string
  amount: number
  currency: 'USD' | 'EUR' | 'XAF'
  memo: string
  status: 'draft' | 'posted' | 'void'
  postedAt?: string | null
  voidedBy?: string | null
  voidedAt?: string | null
  voidReason?: string | null
  reversalOfEntryId?: string | null
  createdAt: string
  updatedAt: string
}

export interface AccountingAccount {
  _id: string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  normalBalance: 'debit' | 'credit'
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface ValidationRule {
  _id: string
  name: string
  scope: 'order' | 'specimen' | 'result' | 'report' | 'finance'
  severity: 'info' | 'warning' | 'blocking'
  active: boolean
  requiredFields: string[]
  message: string
  createdAt: string
  updatedAt: string
}

export type CommunicationThreadType = 'department' | 'direct' | 'broadcast' | 'exception'
export type CommunicationPriority = 'routine' | 'urgent' | 'critical'
export type CommunicationExceptionType =
  | 'rejected_sample'
  | 'missing_payment'
  | 'failed_qc'
  | 'delayed_tat'
  | 'missing_specimen'
  | 'unread_clinician_response'
export type CommunicationMessageType = 'message' | 'broadcast' | 'exception' | 'system'

export interface CommunicationAttachment {
  _id: string
  filename: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string
  storageProvider?: 'local' | 's3' | null
  storagePath?: string | null
  documentId?: string | null
  uploadedBy: string
  uploadedAt: string
  retentionUntil: string
}

export interface InternalChatMessage {
  _id: string
  threadId: string
  senderId: string
  senderName: string
  senderRole: UserRole
  body: string
  messageType?: CommunicationMessageType
  regulated?: boolean
  mandatoryRead?: boolean
  attachments?: CommunicationAttachment[]
  readBy: Array<{
    userId: string
    readAt: string
  }>
  createdAt: string
  updatedAt: string
}

export interface InternalChatThread {
  _id: string
  title: string
  department: string
  departments?: string[]
  threadType?: CommunicationThreadType
  participantUserIds: string[]
  audienceRoles?: UserRole[] | null
  linkedOrderId?: string | null
  linkedSpecimenId?: string | null
  linkedOrderItemId?: string | null
  linkedInvoiceId?: string | null
  linkedReportId?: string | null
  exceptionType?: CommunicationExceptionType | null
  sourceReferenceId?: string | null
  priority?: CommunicationPriority
  regulated?: boolean
  broadcast?: boolean
  retentionUntil?: string | null
  closedAt?: string | null
  closedBy?: string | null
  createdBy: string
  lastMessageAt?: string | null
  createdAt: string
  updatedAt: string
  lastMessage?: InternalChatMessage | null
  unreadCount?: number
}
