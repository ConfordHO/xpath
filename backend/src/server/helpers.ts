import { randomBytes } from "node:crypto";

import type { AuthRequest } from "../auth.js";
import { isSuperAdmin, normalizeSiteId } from "../auth.js";
import {
  describeOrderWorkflowRoutes,
  getOrderWorkflowPlan,
  getWorkflowItemDashboard,
} from "./workflowPlans.js";
import type {
  Accession,
  CourierStatus,
  Database,
  Doctor,
  Notification,
  Order,
  OrderVisibilityBlocker,
  PaymentMethod,
  Patient,
  Report,
  Sample,
  User,
  WorkflowHistoryEntry,
} from "../types.js";

export function now() {
  return new Date().toISOString();
}

export function createId() {
  return randomBytes(12).toString("hex");
}

export function trimText(value?: string | null) {
  return String(value ?? "").trim();
}

export function sameTrimmedText(left?: string | null, right?: string | null) {
  return trimText(left) === trimText(right);
}

export function occurredWithinWindow(timestamp?: string | null, windowMs = 15_000) {
  if (!timestamp) {
    return false;
  }
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return Math.abs(Date.now() - parsed) <= windowMs;
}

export function createOrderNumber(db: Database) {
  const current = db.orders
    .map((order) => order.orderNumber)
    .concat(db.orderNumberReservations.map((entry) => entry.orderNumber))
    .map((orderNumber) => Number(orderNumber.replace("ORD-", "")))
    .filter((value) => Number.isFinite(value));
  const next = (current.length ? Math.max(...current) : 0) + 1;
  return `ORD-${String(next).padStart(6, "0")}`;
}

export function createAccessionLabel(db: Database) {
  const year = new Date().getUTCFullYear().toString().slice(-2);
  const current = db.accessions
    .map((entry) => {
      const match = entry.accessionId.match(/^XP-\d{2}-(\d{6})$/);
      return match ? Number(match[1]) : Number.NaN;
    })
    .filter((value) => Number.isFinite(value));
  const serial = String((current.length ? Math.max(...current) : 0) + 1).padStart(6, "0");
  return `XP-${year}-${serial}`;
}

export function normalizeCourierStatus(status?: string | null): CourierStatus {
  switch (status) {
    case "requested":
      return "ready_for_pickup";
    case "on_the_way":
      return "on_way_to_pickup";
    case "at_site":
      return "at_site_for_pickup";
    case "picked_up":
      return "picked_up_on_way_to_lab";
    case "ready_for_pickup":
    case "on_way_to_pickup":
    case "at_site_for_pickup":
    case "picked_up_on_way_to_lab":
    case "in_transit":
    case "received_at_lab":
      return status;
    default:
      return "";
  }
}

export function ensureUser(req: AuthRequest) {
  if (!req.user) {
    throw new Error("Missing authenticated user");
  }
  return req.user;
}

export function findDoctorByUserId(db: Database, userId: string) {
  return db.doctors.find((entry) => entry.userId === userId) ?? null;
}

export function userCanAccessUser(actor: User, target: User) {
  if (isSuperAdmin(actor)) {
    return true;
  }
  if (actor.role === "admin") {
    return !isSuperAdmin(target) && normalizeSiteId(actor.siteId) === normalizeSiteId(target.siteId);
  }
  return actor._id === target._id;
}

export function userCanManageUser(actor: User, target: User) {
  if (isSuperAdmin(actor)) {
    return true;
  }
  if (actor.role !== "admin") {
    return actor._id === target._id;
  }
  if (target.role === "super_admin" || target.role === "admin") {
    return false;
  }
  return normalizeSiteId(actor.siteId) === normalizeSiteId(target.siteId);
}

export function userCanCreateRole(actor: User, role: User["role"], siteId?: string | null) {
  if (isSuperAdmin(actor)) {
    return true;
  }
  if (actor.role !== "admin") {
    return false;
  }
  if (role === "super_admin" || role === "admin") {
    return false;
  }
  return normalizeSiteId(actor.siteId) === normalizeSiteId(siteId);
}

export function userCanAccessDoctor(actor: User, doctor: Doctor) {
  if (isSuperAdmin(actor)) {
    return true;
  }
  if (actor.role === "doctor") {
    return doctor.userId === actor._id;
  }
  return normalizeSiteId(actor.siteId) === normalizeSiteId(doctor.siteId);
}

export function userCanAccessPatient(actor: User, patient: Patient) {
  if (isSuperAdmin(actor)) {
    return true;
  }
  return normalizeSiteId(actor.siteId) === normalizeSiteId(patient.siteId);
}

function redactDateOfBirth(dateOfBirth: string) {
  const year = dateOfBirth.slice(0, 4);
  return /^\d{4}$/.test(year) ? `${year}-01-01` : dateOfBirth;
}

function projectPatientForActor(actor: User, patient: Patient, order: Order | null): Patient {
  if (
    isSuperAdmin(actor) ||
    actor.role === "admin" ||
    actor.role === "receptionist" ||
    actor.role === "doctor"
  ) {
    return {
      ...patient,
      anonymized: false,
      anonymousLabel: order?.anonymousCaseCode ?? null,
    };
  }

  if (actor.role === "courier") {
    return {
      ...patient,
      email: "",
      anonymized: false,
      anonymousLabel: order?.anonymousCaseCode ?? null,
    };
  }

  const anonymousLabel = order?.anonymousCaseCode ?? `CASE-${patient._id.slice(-6).toUpperCase()}`;
  return {
    ...patient,
    firstName: "Anonymous",
    lastName: anonymousLabel,
    dateOfBirth: redactDateOfBirth(patient.dateOfBirth),
    phone: "",
    email: "",
    address: "Restricted to reception and requester roles",
    anonymized: true,
    anonymousLabel,
  };
}

function notificationVisibleToUser(actor: User, notification: Notification) {
  if (isSuperAdmin(actor)) {
    return true;
  }
  if (notification.siteId && normalizeSiteId(notification.siteId) !== normalizeSiteId(actor.siteId)) {
    return false;
  }
  const targetedByUser = notification.audienceUserIds?.includes(actor._id) ?? false;
  const targetedByRole = notification.audienceRoles?.includes(actor.role) ?? false;
  if (notification.audienceUserIds?.length || notification.audienceRoles?.length) {
    return targetedByUser || targetedByRole;
  }
  return true;
}

export function userCanAccessOrder(db: Database, actor: User, order: Order) {
  if (isSuperAdmin(actor)) {
    return true;
  }
  if (actor.role === "doctor") {
    const doctor = findDoctorByUserId(db, actor._id);
    return Boolean(doctor && order.referringDoctorId === doctor._id);
  }
  if (normalizeSiteId(actor.siteId) !== normalizeSiteId(order.siteId)) {
    return false;
  }
  if (actor.role === "courier") {
    return Boolean(order.orderSource === "online" && order.courierStatus);
  }
  if (actor.role === "finance") {
    return Boolean(order.receivedAt);
  }
  if (actor.role === "technician" || actor.role === "pathologist") {
    return Boolean(order.workflowReleasedAt) && order.financialClearance === "cleared";
  }
  return true;
}

export function userCanAccessAccession(db: Database, actor: User, accession: Accession) {
  return userCanAccessOrder(db, actor, findOrder(db, accession.orderId));
}

export function userCanAccessSample(db: Database, actor: User, sample: Sample) {
  return userCanAccessOrder(db, actor, findOrder(db, sample.orderId));
}

export function scopeDbForUser(db: Database, actor: User): Database {
  if (isSuperAdmin(actor)) {
    return db;
  }

  const visibleOrders = db.orders.filter((order) => userCanAccessOrder(db, actor, order));
  const orderIds = new Set(visibleOrders.map((order) => order._id));
  const patientIds = new Set(visibleOrders.map((order) => order.patientId));
  const orderByPatientId = new Map<string, Order>();
  for (const order of visibleOrders) {
    if (!orderByPatientId.has(order.patientId)) {
      orderByPatientId.set(order.patientId, order);
    }
  }
  const actorSiteId = normalizeSiteId(actor.siteId);
  const sitePatientIds = new Set(
    db.patients
      .filter((entry) => normalizeSiteId(entry.siteId) === actorSiteId)
      .map((entry) => entry._id),
  );
  const accessions = db.accessions.filter((entry) => orderIds.has(entry.orderId));
  const accessionIds = new Set(accessions.map((entry) => entry._id));
  const samples = db.samples.filter((entry) => orderIds.has(entry.orderId));
  const sampleIds = new Set(samples.map((entry) => entry._id));
  const specimens = db.specimens.filter(
    (entry) =>
      orderIds.has(entry.orderId ?? "") ||
      accessionIds.has(entry.accessionId ?? "") ||
      sampleIds.has(entry.sampleId ?? "") ||
      patientIds.has(entry.patientId ?? "") ||
      sitePatientIds.has(entry.patientId ?? ""),
  );
  const specimenIds = new Set(specimens.map((entry) => entry._id));
  const invoices = db.invoices.filter((entry) => orderIds.has(entry.orderId));
  const invoiceIds = new Set(invoices.map((entry) => entry._id));
  const digitalSlides = db.digitalSlides.filter((entry) => orderIds.has(entry.orderId));
  const slideIds = new Set(digitalSlides.map((entry) => entry.slideId));
  const cytologyCases = db.cytologyCases.filter((entry) => orderIds.has(entry.orderId));
  const cytologyCaseIds = new Set(cytologyCases.map((entry) => entry._id));
  const visibleInstrumentIds = new Set(
    db.instruments
      .filter(
        (entry) =>
          !entry.siteId || normalizeSiteId(entry.siteId) === actorSiteId || isSuperAdmin(actor),
      )
      .map((entry) => entry._id),
  );
  const visibleVendorConnectorIds = new Set(
    db.vendorConnectors
      .filter(
        (entry) =>
          !entry.siteId || normalizeSiteId(entry.siteId) === actorSiteId || isSuperAdmin(actor),
      )
      .map((entry) => entry._id),
  );
  const visibleUsers =
    actor.role === "admin"
      ? db.users.filter(
          (entry) =>
            !isSuperAdmin(entry) && normalizeSiteId(entry.siteId) === actorSiteId,
        )
      : db.users.filter((entry) => entry._id === actor._id);
  const visibleUserIds = new Set(visibleUsers.map((entry) => entry._id));
  const visibleDoctors =
    actor.role === "doctor"
      ? db.doctors.filter((entry) => entry.userId === actor._id)
      : db.doctors.filter((entry) => normalizeSiteId(entry.siteId) === actorSiteId);
  const visibleSites =
    actor.role === "doctor"
      ? db.sites.filter((entry) =>
          visibleDoctors.some((doctor) => normalizeSiteId(doctor.siteId) === entry._id),
        )
      : db.sites.filter((entry) => entry._id === actorSiteId);
  const visibleNotifications = db.notifications.filter((entry) =>
    notificationVisibleToUser(actor, entry),
  );

  return {
    ...db,
    users: visibleUsers,
    doctors: visibleDoctors,
    patients:
      actor.role === "doctor"
        ? db.patients
            .filter((entry) => patientIds.has(entry._id))
            .map((entry) => projectPatientForActor(actor, entry, orderByPatientId.get(entry._id) ?? null))
        : db.patients
            .filter(
              (entry) =>
                normalizeSiteId(entry.siteId) === actorSiteId || patientIds.has(entry._id),
            )
            .map((entry) => projectPatientForActor(actor, entry, orderByPatientId.get(entry._id) ?? null)),
    hl7Messages:
      actor.role === "doctor"
        ? db.hl7Messages.filter((entry) =>
            Array.from(patientIds).some((patientId) => entry.rawMessage.includes(patientId)),
          )
        : db.hl7Messages,
    specimens,
    specimenStatusHistory: db.specimenStatusHistory.filter((entry) =>
      specimenIds.has(entry.specimenId),
    ),
    resultRecords: db.resultRecords.filter((entry) => specimenIds.has(entry.specimenId)),
    specimenImages: db.specimenImages.filter((entry) => specimenIds.has(entry.specimenId)),
    orders: visibleOrders,
    orderAmendments: db.orderAmendments.filter((entry) => orderIds.has(entry.orderId)),
    ocrIntakeJobs: db.ocrIntakeJobs.filter(
      (entry) =>
        isSuperAdmin(actor) ||
        normalizeSiteId(entry.siteId) === actorSiteId ||
        visibleUserIds.has(entry.createdBy),
    ),
    orderCorrections: db.orderCorrections.filter((entry) => orderIds.has(entry.orderId)),
    orderLocks: db.orderLocks.filter((entry) => orderIds.has(entry.orderId)),
    payments: db.payments.filter((entry) => orderIds.has(entry.orderId)),
    mavianceTransactions: db.mavianceTransactions.filter(
      (entry) =>
        orderIds.has(entry.orderId) ||
        (!entry.siteId && actor.role === "super_admin") ||
        normalizeSiteId(entry.siteId) === actorSiteId,
    ),
    insuranceAuthorizations: db.insuranceAuthorizations.filter((entry) =>
      orderIds.has(entry.orderId),
    ),
    invoices,
    refunds: db.refunds.filter(
      (entry) => orderIds.has(entry.orderId) || invoiceIds.has(entry.invoiceId ?? ""),
    ),
    accountingAccounts: db.accountingAccounts,
    accountingJournalEntries: db.accountingJournalEntries.filter(
      (entry) =>
        orderIds.has(entry.orderId ?? "") ||
        db.payments.some((payment) => payment._id === entry.paymentId && orderIds.has(payment.orderId)) ||
        db.refunds.some((refund) => refund._id === entry.refundId && orderIds.has(refund.orderId)) ||
        actor.role === "admin" ||
        actor.role === "finance",
    ),
    accountingExportBatches: db.accountingExportBatches,
    zohoBooksSyncLogs: db.zohoBooksSyncLogs.filter(
      (entry) =>
        actor.role === "admin" ||
        actor.role === "finance" ||
        orderIds.has(entry.orderId ?? ""),
    ),
    accessions,
    samples,
    barcodes: db.barcodes.filter(
      (entry) =>
        !entry.entityId ||
        sampleIds.has(entry.entityId) ||
        accessionIds.has(entry.entityId) ||
        slideIds.has(entry.entityId),
    ),
    chainOfCustody: db.chainOfCustody.filter((entry) => sampleIds.has(entry.specimenId)),
    preAnalyticsLogs: db.preAnalyticsLogs.filter((entry) => orderIds.has(entry.orderId)),
    histologyWorklist: db.histologyWorklist.filter((entry) =>
      accessionIds.has(entry.accessionId),
    ),
    reports: db.reports.filter((entry) => orderIds.has(entry.orderId)),
    cytologyCases,
    cytologyQualityRecords: db.cytologyQualityRecords.filter((entry) =>
      cytologyCaseIds.has(entry.cytologyCaseId),
    ),
    digitalSlides,
    aiResults: db.aiResults.filter((entry) => slideIds.has(entry.slideId)),
    instruments: db.instruments.filter((entry) => visibleInstrumentIds.has(entry._id)),
    instrumentRuns: db.instrumentRuns.filter(
      (entry) =>
        visibleInstrumentIds.has(entry.instrumentId) ||
        orderIds.has(entry.orderId ?? "") ||
        accessionIds.has(entry.accessionId ?? "") ||
        slideIds.has(entry.slideId ?? ""),
    ),
    vendorConnectors: db.vendorConnectors.filter((entry) =>
      visibleVendorConnectorIds.has(entry._id),
    ),
    vendorJobs: db.vendorJobs.filter(
      (entry) =>
        visibleVendorConnectorIds.has(entry.connectorId) ||
        orderIds.has(entry.orderId ?? "") ||
        accessionIds.has(entry.accessionId ?? "") ||
        slideIds.has(entry.slideId ?? ""),
    ),
    vendorWebhookEvents: db.vendorWebhookEvents.filter(
      (entry) =>
        visibleVendorConnectorIds.has(entry.connectorId ?? "") ||
        orderIds.has(entry.orderId ?? "") ||
        accessionIds.has(entry.accessionId ?? "") ||
        slideIds.has(entry.slideId ?? ""),
    ),
    workflowHistory: db.workflowHistory.filter(
      (entry) => !entry.orderId || orderIds.has(entry.orderId),
    ),
    notifications: visibleNotifications,
    communicationLogs: db.communicationLogs.filter((entry) => orderIds.has(entry.orderId)),
    tatAlerts: db.tatAlerts.filter((entry) => !entry.orderId || orderIds.has(entry.orderId)),
    archiveRecords: db.archiveRecords.filter(
      (entry) =>
        sampleIds.has(entry.entityId) ||
        accessionIds.has(entry.entityId) ||
        slideIds.has(entry.entityId),
    ),
    documents: db.documents,
    auditEvents: db.auditEvents.filter(
      (entry) =>
        !entry.siteId ||
        normalizeSiteId(entry.siteId) === actorSiteId ||
        orderIds.has(entry.orderId ?? "") ||
        visibleUserIds.has(entry.actorUserId ?? ""),
    ),
    sessionRecords: db.sessionRecords.filter(
      (entry) => entry.userId === actor._id || visibleUserIds.has(entry.userId),
    ),
    credentialAudits: db.credentialAudits.filter(
      (entry) => entry.userId === actor._id || visibleUserIds.has(entry.userId),
    ),
    sites: visibleSites,
    siteTransfers: db.siteTransfers.filter(
      (entry) =>
        orderIds.has(entry.orderId) ||
        entry.fromSiteId === actorSiteId ||
        entry.toSiteId === actorSiteId,
    ),
  };
}

export function formatCurrency(db: Database, amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: db.settings.currency,
  }).format(amount);
}

export function findDoctor(db: Database, doctorId?: string | null) {
  return doctorId ? db.doctors.find((entry) => entry._id === doctorId) ?? null : null;
}

export function findUser(db: Database, userId?: string | null) {
  return userId ? db.users.find((entry) => entry._id === userId) ?? null : null;
}

export function findPatient(db: Database, patientId: string) {
  const patient = db.patients.find((entry) => entry._id === patientId);
  if (!patient) {
    throw new Error("Patient not found");
  }
  return patient;
}

export function findOrder(db: Database, orderId: string) {
  const order = db.orders.find((entry) => entry._id === orderId);
  if (!order) {
    throw new Error("Order not found");
  }
  return order;
}

export function findAccession(db: Database, accessionId: string) {
  const accession = db.accessions.find((entry) => entry._id === accessionId);
  if (!accession) {
    throw new Error("Accession not found");
  }
  return accession;
}

export function getOrderTestTypes(db: Database, order: Order) {
  return db.testTypes.filter((testType) => order.testTypeIds.includes(testType._id));
}

export function getOrderPayments(db: Database, orderId: string) {
  return db.payments
    .filter((payment) => payment.orderId === orderId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getOrderTotal(db: Database, order: Order) {
  return getOrderTestTypes(db, order).reduce((sum, testType) => sum + testType.price, 0);
}

export function getOrderPaid(db: Database, orderId: string) {
  return getOrderPayments(db, orderId)
    .filter((payment) => payment.status === "completed")
    .reduce((sum, payment) => sum + payment.amount, 0);
}

export function getAccessionByOrder(db: Database, orderId: string) {
  return db.accessions.find((entry) => entry.orderId === orderId) ?? null;
}

export function getSampleByOrder(db: Database, orderId: string) {
  return db.samples.find((entry) => entry.orderId === orderId) ?? null;
}

export function getReportByOrder(db: Database, orderId: string): Report | null {
  return db.reports.find((entry) => entry.orderId === orderId) ?? null;
}

export function buildTimeline(db: Database, order: Order) {
  const timeline: Array<{ label: string; at: string; value?: string }> = [
    { label: "Order created", at: order.createdAt },
  ];

  if (order.courierCheckedInAt) {
    timeline.push({
      label: "Courier checked in",
      at: order.courierCheckedInAt,
      value: courierLabel(order.courierStatus),
    });
  }

  if (order.courierReceivedAt) {
    timeline.push({
      label: "Sample received at lab (courier)",
      at: order.courierReceivedAt,
      value: "Received at lab",
    });
  } else if (order.receivedAt) {
    timeline.push({
      label: "Order received",
      at: order.receivedAt,
    });
  }

  const accession = getAccessionByOrder(db, order._id);
  if (accession?.grossedAt) {
    timeline.push({ label: "Grossing completed", at: accession.grossedAt });
  }
  if (accession?.processedAt) {
    timeline.push({ label: "Processing completed", at: accession.processedAt });
  }
  if (accession?.embeddedAt) {
    timeline.push({ label: "Embedding completed", at: accession.embeddedAt });
  }
  if (accession?.sectionedAt) {
    timeline.push({ label: "Sectioning completed", at: accession.sectionedAt });
  }
  if (accession?.stainedAt) {
    timeline.push({ label: "Staining completed", at: accession.stainedAt });
  }

  const cytologyCase = db.cytologyCases.find((entry) => entry.orderId === order._id) ?? null;
  if (cytologyCase) {
    timeline.push({
      label: "Cytology case created",
      at: cytologyCase.createdAt,
      value: cytologyCase.caseNumber,
    });
  }
  if (cytologyCase?.qcStatus === "pass" || cytologyCase?.status === "complete") {
    timeline.push({
      label: "Cytology QC completed",
      at: cytologyCase.updatedAt,
      value: cytologyCase.qcStatus ?? "complete",
    });
  }

  const instrumentRuns = db.instrumentRuns
    .filter((entry) => entry.orderId === order._id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const run of instrumentRuns) {
    timeline.push({
      label: `Technical run completed`,
      at: run.updatedAt,
      value: run.runType,
    });
  }

  const report = getReportByOrder(db, order._id);
  if (report?.lockedAt) {
    timeline.push({ label: "Report completed", at: report.lockedAt });
  }
  if (report?.reviewRequestedAt) {
    timeline.push({
      label: "Second pathologist review requested",
      at: report.reviewRequestedAt,
      value: report.secondReviewerName ?? undefined,
    });
  }
  if (report?.reviewReturnedAt) {
    timeline.push({ label: "Report returned for corrections", at: report.reviewReturnedAt });
  }
  if (report?.reviewValidatedAt) {
    timeline.push({
      label: "Second pathologist review validated",
      at: report.reviewValidatedAt,
      value: report.secondReviewerName ?? undefined,
    });
  }
  if (report?.finalizedAt) {
    timeline.push({ label: "Report finalized for release", at: report.finalizedAt });
  }
  if (order.releasedAt) {
    timeline.push({ label: "Result released", at: order.releasedAt });
  }

  return timeline.sort((a, b) => a.at.localeCompare(b.at));
}

export function getOrderBlockers(db: Database, order: Order): OrderVisibilityBlocker[] {
  const blockers: OrderVisibilityBlocker[] = [];
  if (order.orderSource === "online" && order.courierStatus && order.courierStatus !== "received_at_lab") {
    blockers.push({
      code: "courier_delivery_pending",
      ownerRole: "courier",
      title: "Courier delivery still pending",
      message: "The courier must complete pickup and mark the sample as delivered to the reception desk.",
    });
  }
  if (!order.receivedAt) {
    blockers.push({
      code: "reception_confirmation_pending",
      ownerRole: "receptionist",
      title: "Reception confirmation pending",
      message: "Reception must confirm the sample was physically received before the lab can act on it.",
    });
  }
  if (order.financialClearance !== "cleared") {
    blockers.push({
      code: "financial_clearance_pending",
      ownerRole: "receptionist/finance",
      title: "Financial clearance pending",
      message: "Payment or reconciliation is still pending, so downstream lab users should not continue yet.",
    });
  }
  if (!order.workflowReleasedAt && !["completed", "released", "cancelled"].includes(order.status)) {
    blockers.push({
      code: "workflow_release_pending",
      ownerRole: "receptionist",
      title: "Workflow routing pending",
      message: "Reception must route the tests to the correct workflow(s) before technicians and pathologists can proceed.",
    });
  }
  if (
    order.workflowReleasedAt &&
    getOrderWorkflowPlan(db, order).requiresTechnician &&
    !order.assignedTechnicianId &&
    order.status !== "review"
  ) {
    blockers.push({
      code: "technician_assignment_pending",
      ownerRole: "receptionist",
      title: "Technician assignment pending",
      message: "A technician still needs to be assigned for the laboratory workflow to continue cleanly.",
    });
  }
  return blockers;
}

export function hydrateDoctor(doctor: Doctor, db: Database) {
  const linkedUser = findUser(db, doctor.userId);
  return {
    ...doctor,
    user: linkedUser
      ? {
          _id: linkedUser._id,
          email: linkedUser.email,
          name: linkedUser.name,
        }
      : null,
  };
}

export function hydrateOrder(db: Database, order: Order) {
  const patient = findPatient(db, order.patientId);
  const doctor = findDoctor(db, order.referringDoctorId);
  const assignedTechnician = findUser(db, order.assignedTechnicianId);
  const assignedPathologist = findUser(db, order.assignedPathologistId);
  const report = getReportByOrder(db, order._id);
  const workflowPlan = getOrderWorkflowPlan(db, order);
  const workflowRoutes = describeOrderWorkflowRoutes(db, order);
  return {
    ...order,
    courierStatus: normalizeCourierStatus(order.courierStatus),
    patient,
    testTypes: getOrderTestTypes(db, order),
    workflowPlan,
    workflowRoutes,
    blockers: getOrderBlockers(db, order),
    referringDoctor: doctor?.name ?? order.referringDoctorName ?? null,
    referringDoctorId: doctor
      ? {
          _id: doctor._id,
          name: doctor.name,
          code: doctor.code,
          type: doctor.type,
        }
      : null,
    assignedTechnician: assignedTechnician
      ? {
          _id: assignedTechnician._id,
          email: assignedTechnician.email,
          name: assignedTechnician.name,
          role: assignedTechnician.role,
        }
      : null,
    assignedPathologist: assignedPathologist
      ? {
          _id: assignedPathologist._id,
          email: assignedPathologist.email,
          name: assignedPathologist.name,
          role: assignedPathologist.role,
        }
      : null,
    completedAt: order.completedAt ?? report?.lockedAt ?? null,
    reportTrafficLightStatus: report?.trafficLightStatus ?? "red",
    reportReviewStatus: report?.reviewStatus ?? "draft_in_progress",
    reportSecondReviewerId: report?.secondReviewerId ?? null,
    reportSecondReviewerName: report?.secondReviewerName ?? null,
    reportSummary: report?.comment ?? null,
    pathologistDiagnosis: report?.diagnosis ?? null,
  };
}

export function hydrateSample(db: Database, sample: Sample) {
  return {
    ...sample,
    order: hydrateOrder(db, findOrder(db, sample.orderId)),
  };
}

export function hydrateAccession(db: Database, accession: Accession) {
  return {
    ...accession,
    order: findOrder(db, accession.orderId),
  };
}

export function buildReport(db: Database, order: Order) {
  const existing = getReportByOrder(db, order._id);
  if (existing) {
    return existing;
  }
  const accession = getAccessionByOrder(db, order._id);
  return {
    _id: createId(),
    orderId: order._id,
    accessionId: accession?._id ?? null,
    status: "draft" as const,
    trafficLightStatus: "red" as const,
    reviewStatus: "draft_in_progress" as const,
    diagnosis: "",
    microscopicDescription: "",
    grossDescription: accession?.grossDescription ?? "",
    comment: "",
    authorId: null,
    reportingPathologistId: order.assignedPathologistId ?? null,
    reportingPathologistName: findUser(db, order.assignedPathologistId)?.name ?? null,
    secondReviewerId: null,
    secondReviewerName: null,
    reviewRequestedAt: null,
    reviewReturnedAt: null,
    reviewValidatedAt: null,
    finalizedAt: null,
    finalizedBy: null,
    finalizationComment: null,
    releaseRuleStatus: "pending" as const,
    reviewComments: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

export function createWorkflowHistoryEntry(
  templateId: string,
  templateName: string,
  order?: Order,
  notes?: string,
): WorkflowHistoryEntry {
  return {
    _id: createId(),
    workflowTemplateId: templateId,
    workflowTemplateName: templateName,
    orderId: order?._id,
    patientName: order ? `${order.orderNumber}` : undefined,
    completedAt: now(),
    notes,
  };
}

export function getFinanceSummary(db: Database) {
  const completed = db.payments.filter((payment) => payment.status === "completed");
  const pending = db.payments.filter((payment) => payment.status === "pending");
  const byMethod = completed.reduce<Record<PaymentMethod, number>>(
    (acc, payment) => {
      const method = normalizePaymentMethod(payment.method);
      acc[method] += payment.amount;
      return acc;
    },
    {
      cash: 0,
      card: 0,
      mobile_money: 0,
      bank_transfer: 0,
      mtn_mobile_money: 0,
      orange_money: 0,
      transfer: 0,
      other: 0,
    },
  );

  const totalRevenue = completed.reduce((sum, payment) => sum + payment.amount, 0);

  return {
    totalRevenue,
    totalRevenueDisplay: formatCurrency(db, totalRevenue),
    completedPayments: completed.length,
    pendingPayments: pending.length,
    transactions: completed
      .concat(pending)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((payment) => ({
        ...payment,
        order: hydrateOrder(db, findOrder(db, payment.orderId)),
        amountDisplay: formatCurrency(db, payment.amount),
      })),
    paymentsByMethod: byMethod,
  };
}

export function buildDashboardSummary(db: Database) {
  const totalOrders = db.orders.length;
  const reviewOrders = db.orders.filter((order) => order.status === "review").length;
  const pendingPickup = db.orders.filter(
    (order) => order.courierStatus && order.courierStatus !== "received_at_lab",
  ).length;
  const readyReports = db.reports.filter(
    (report) => report.releaseRuleStatus === "ready" || report.reviewStatus === "ready_for_release",
  ).length;
  const workflowItems = getWorkflowItemDashboard(db);
  return {
    totalOrders,
    reviewOrders,
    pendingPickup,
    readyReports,
    workflowItems: {
      total: workflowItems.total,
      pending: workflowItems.pending,
      blocked: workflowItems.blocked,
      inProgress: workflowItems.inProgress,
      completed: workflowItems.completed,
      released: workflowItems.released,
      cancelled: workflowItems.cancelled,
      resolved: workflowItems.resolved,
    },
    latestOrders: db.orders
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
      .map((order) => hydrateOrder(db, order)),
    countsByStatus: {
      draft: db.orders.filter((order) => order.status === "draft").length,
      received: db.orders.filter((order) => order.status === "received").length,
      in_progress: db.orders.filter((order) => order.status === "in_progress").length,
      review: db.orders.filter((order) => order.status === "review").length,
      completed: db.orders.filter((order) => order.status === "completed").length,
      released: db.orders.filter((order) => order.status === "released").length,
      cancelled: db.orders.filter((order) => order.status === "cancelled").length,
    },
  };
}

export function courierLabel(status: CourierStatus) {
  const map: Record<CourierStatus, string> = {
    "": "Not started",
    ready_for_pickup: "Scheduled for pickup",
    on_way_to_pickup: "Courier on the way to pick up",
    at_site_for_pickup: "Courier at your location",
    picked_up_on_way_to_lab: "Sample picked up, on the way to lab",
    in_transit: "In transit to lab",
    received_at_lab: "Received at lab",
  };
  return map[status];
}

export function normalizePaymentMethod(method: PaymentMethod): PaymentMethod {
  if (method === "transfer") {
    return "bank_transfer";
  }
  if (method === "other") {
    return "bank_transfer";
  }
  return method;
}
