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
  status: 'complete' | 'current' | 'pending'
}

export interface OrderWorkflowPlan {
  summary: string
  routeTags: string[]
  requiresTechnician: boolean
  nextStageId: OrderWorkflowStageId | null
  nextStageLabel: string | null
  nextModule: OrderWorkflowModule | null
  reviewReady: boolean
  stages: OrderWorkflowStageState[]
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
  nationalId?: string
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
  status: 'open' | 'review' | 'complete'
  remarks: string
  routeType?: 'gyn' | 'non_gyn'
  preparationType?: 'smear' | 'cell_block' | 'liquid_based'
  qcStatus?: 'pending' | 'pass' | 'fail'
  qcNotes?: string
  createdAt: string
  updatedAt: string
}

export interface HydratedOrder {
  _id: string
  orderNumber: string
  patient: Patient
  testTypes: TestType[]
  workflowPlan: OrderWorkflowPlan
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
  courierCheckedInAt?: string | null
  courierReceivedAt?: string | null
  completedAt?: string | null
  releasedAt?: string | null
  reportSummary?: string | null
  pathologistDiagnosis?: string | null
  createdAt: string
  updatedAt: string
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
  createdAt: string
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
  status: 'draft' | 'issued' | 'paid' | 'refunded'
  paymentGateway: 'cash' | 'card' | 'mpesa' | 'maviance' | 'bank_transfer' | 'insurance'
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
  status: 'pending' | 'approved' | 'completed'
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
  createdAt: string
  updatedAt: string
}

export interface LabelTemplateRecord {
  _id: string
  name: string
  printerName: string
  templateType: 'specimen' | 'block' | 'slide' | 'case'
  scanEnforced: boolean
  createdAt: string
  updatedAt: string
}

export interface ChainOfCustodyEvent {
  _id: string
  specimenId: string
  eventType: 'collected' | 'picked_up' | 'received' | 'aliquoted' | 'transferred' | 'rejected'
  location: string
  condition: string
  actor: string
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
  notes: string
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
  createdAt: string
}

export interface DashboardSummary {
  totalOrders: number
  reviewOrders: number
  pendingPickup: number
  readyReports: number
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
