import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Pool } from "pg";
import supertest from "supertest";

const testStateId = `app_state_test_${Date.now()}`;
process.env.POSTGRES_STATE_ID = testStateId;
process.env.HL7_MLLP_ENABLED = "false";

let request: ReturnType<typeof supertest>;
let pgPool: Pool | null = null;
let pgTable = "app_state";
let authToken = "";
let createdOrderId = "";
let createdAccessionId = "";

async function loginAdmin() {
  return loginUser("admin@xpath.lims");
}

async function loginUser(email: string) {
  const login = await request.post("/api/auth/login").send({
    email,
    password: "admin123",
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  return login.body.token as string;
}

before(async () => {
  const serverModule = await import("../src/server.js");
  const configModule = await import("../src/config.js");

  request = supertest(serverModule.app);
  pgTable = configModule.POSTGRES_STATE_TABLE;
  pgPool = new Pool({
    connectionString: configModule.DATABASE_URL,
    ssl:
      configModule.DATABASE_SSL_MODE === "require"
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await pgPool.query("SELECT 1");
});

after(async () => {
  const storeModule = await import("../src/store.js");
  await storeModule.closeStoreConnections();
  if (pgPool) {
    const quotedTable = `"${pgTable.replace(/"/g, "")}"`;
    await pgPool
      .query(`DELETE FROM ${quotedTable} WHERE id = $1`, [testStateId])
      .catch(() => undefined);
    await pgPool.end();
  }
});

describe("production hardening", () => {
  test("health, authentication, and audit verification succeed", async () => {
    const health = await request.get("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);

    const publicRegister = await request.post("/api/auth/register").send({
      name: "Unexpected Public Admin",
      email: `public-admin-${Date.now()}@xpath.test`,
      role: "admin",
      password: "UnsafePublic1!",
    });
    assert.equal(publicRegister.status, 404);

    authToken = await loginAdmin();

    const auditVerify = await request
      .get("/api/audit/verify")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(auditVerify.status, 200);
    assert.equal(auditVerify.body.valid, true);
    assert.ok(Number(auditVerify.body.checked) >= 1);
  });

  test("tat dashboard returns analytics for admins", async () => {
    const response = await request
      .get("/api/tat/dashboard?range=monthly")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.entries));
    assert.ok(response.body.averages);
  });

  test("document uploads and downloads work through DMS storage", async () => {
    const upload = await request
      .post("/api/documents/upload")
      .set("Authorization", `Bearer ${authToken}`)
      .field("title", "Validation SOP")
      .field("category", "SOP")
      .field("version", "1.0")
      .field("owner", "Quality")
      .field("accessLevel", "controlled")
      .field("trainingDueAt", "2026-12-31")
      .attach("file", Buffer.from("validation-body", "utf8"), {
        filename: "validation.txt",
        contentType: "text/plain",
      });

    assert.equal(upload.status, 201);
    assert.equal(upload.body.originalFilename, "validation.txt");

    const replacement = await request
      .post(`/api/documents/${upload.body._id}/file`)
      .set("Authorization", `Bearer ${authToken}`)
      .field("version", "1.1")
      .attach("file", Buffer.from("validation-body-v2", "utf8"), {
        filename: "validation-v2.txt",
        contentType: "text/plain",
      });

    assert.equal(replacement.status, 200);
    assert.equal(replacement.body.version, "1.1");
    assert.equal(replacement.body.versions[0]?.version, "1.1");

    const download = await request
      .get(`/api/documents/${upload.body._id}/file`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(download.status, 200);
    assert.match(String(download.header["content-type"] ?? ""), /^text\/plain/);
    assert.match(download.text, /validation-body-v2/);
  });

  test("barcode enforcement blocks invalid histology progression and records order audit events", async () => {
    const timestamp = Date.now();
    const patientCreate = await request
      .post("/api/patients")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        firstName: "Test",
        lastName: `Patient${timestamp}`,
        dateOfBirth: "1990-01-01",
        gender: "female",
        phone: `+23769000${String(timestamp).slice(-4)}`,
        email: `patient.${timestamp}@xpath.test`,
        address: "Yaounde",
      });

    assert.equal(patientCreate.status, 201);

    const orderCreate = await request
      .post("/api/orders")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        patientId: patientCreate.body._id,
        testTypeIds: ["test-hi-t-001"],
        priority: "normal",
        orderSource: "walk_in",
        notes: "Automated hardening test",
        clinicalHistory: "Test case for histology",
      });

    assert.equal(orderCreate.status, 201);
    createdOrderId = orderCreate.body._id as string;

    const orderTotal = 1000000;

    const payment = await request
      .post(`/api/orders/${createdOrderId}/payment`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        amount: orderTotal,
        method: "cash",
        status: "completed",
      });
    assert.equal(payment.status, 201);

    const receptionIntake = await request
      .post(`/api/orders/${createdOrderId}/reception-intake`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        paymentCollectionStatus: "reconciled",
        paymentCollectionMethod: "cash",
        paymentCollectionAmount: orderTotal,
        paymentCollectionReference: "TEST-RECEPTION",
        transportTemperature: "ambient",
        transportCondition: "stable",
        sampleCondition: "Received intact at reception",
        scannedCode: orderCreate.body.orderNumber,
      });
    assert.equal(receptionIntake.status, 200);

    const users = await request
      .get("/api/users")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(users.status, 200);
    const technician = users.body.find((entry: { role: string }) => entry.role === "technician");
    assert.ok(technician);

    const releaseToLab = await request
      .post(`/api/orders/${createdOrderId}/release-to-lab`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ technicianId: technician._id, scannedCode: orderCreate.body.orderNumber });
    assert.equal(releaseToLab.status, 200);

    const startProcessing = await request
      .post(`/api/orders/${createdOrderId}/start-processing`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ scannedCode: orderCreate.body.orderNumber });
    assert.equal(startProcessing.status, 200);

    const accessionLookup = await request
      .get(`/api/accessions/by-order/${createdOrderId}`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(accessionLookup.status, 200);
    createdAccessionId = accessionLookup.body._id as string;

    const grossingRejected = await request
      .post(`/api/accessions/${createdAccessionId}/grossing`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        grossDescription: "Specimen received for biopsy",
        numberOfBlocks: 1,
      });
    assert.equal(grossingRejected.status, 400);
    assert.match(grossingRejected.body.message, /barcode scan is required/i);

    const grossingAccepted = await request
      .post(`/api/accessions/${createdAccessionId}/grossing`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        grossDescription: "Specimen received for biopsy",
        numberOfBlocks: 1,
        scannedCode: accessionLookup.body.accessionId,
      });
    assert.equal(grossingAccepted.status, 200);

    const auditTrail = await request
      .get(`/api/orders/${createdOrderId}/audit`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(auditTrail.status, 200);
    assert.ok(
      auditTrail.body.some((entry: { action: string }) =>
        ["create", "accession", "grossing"].includes(entry.action),
      ),
    );
  });

  test("multi-test single order keeps independent item plans, shared specimens, explicit IHC dependency, and final release gate", async () => {
    const timestamp = Date.now();
    const patientCreate = await request
      .post("/api/patients")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        firstName: "Multi",
        lastName: `Route${timestamp}`,
        dateOfBirth: "1982-06-12",
        gender: "female",
        phone: `+23769111${String(timestamp).slice(-4)}`,
        email: `multi.route.${timestamp}@xpath.test`,
        address: "Douala",
      });
    assert.equal(patientCreate.status, 201);

    const orderCreate = await request
      .post("/api/orders")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        patientId: patientCreate.body._id,
        testTypeIds: ["test-hi-t-001", "test-im-t-01"],
        priority: "urgent",
        orderSource: "walk_in",
        notes: "Automated Workflow E test",
        clinicalHistory: "Shared tissue specimen with IHC dependency",
      });
    assert.equal(orderCreate.status, 201);
    assert.equal(orderCreate.body.workflowPlan.itemPlans.length, 2);
    assert.equal(orderCreate.body.workflowPlan.itemSummary.pending, 2);

    const payment = await request
      .post(`/api/orders/${orderCreate.body._id}/payment`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        amount: 170000,
        method: "cash",
        status: "completed",
      });
    assert.equal(payment.status, 201);

    const receptionIntake = await request
      .post(`/api/orders/${orderCreate.body._id}/reception-intake`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        paymentCollectionStatus: "reconciled",
        paymentCollectionMethod: "cash",
        paymentCollectionAmount: 170000,
        paymentCollectionReference: "TEST-MULTI-E2E",
        transportTemperature: "ambient",
        transportCondition: "stable",
        sampleCondition: "One tissue specimen received intact",
        scannedCode: orderCreate.body.orderNumber,
      });
    assert.equal(receptionIntake.status, 200);

    const users = await request
      .get("/api/users")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(users.status, 200);
    const technician = users.body.find((entry: { role: string }) => entry.role === "technician");
    const pathologist = users.body.find((entry: { role: string }) => entry.role === "pathologist");
    assert.ok(technician);
    assert.ok(pathologist);

    const releaseToLab = await request
      .post(`/api/orders/${orderCreate.body._id}/release-to-lab`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ technicianId: technician._id, scannedCode: orderCreate.body.orderNumber });
    assert.equal(releaseToLab.status, 200);

    const startProcessing = await request
      .post(`/api/orders/${orderCreate.body._id}/start-processing`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ scannedCode: orderCreate.body.orderNumber });
    assert.equal(startProcessing.status, 200);

    const accessionLookup = await request
      .get(`/api/accessions/by-order/${orderCreate.body._id}`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(accessionLookup.status, 200);
    const accessionId = accessionLookup.body._id as string;

    const itemDetailAfterAccession = await request
      .get(`/api/orders/${orderCreate.body._id}`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(itemDetailAfterAccession.status, 200);
    assert.equal(itemDetailAfterAccession.body.workflowPlan.itemPlans.length, 2);
    assert.ok(
      itemDetailAfterAccession.body.workflowPlan.itemPlans.every(
        (item: { specimenLinks: Array<{ sharedWithOrderItemIds: string[] }> }) =>
          item.specimenLinks.some((link) => link.sharedWithOrderItemIds.length === 2),
      ),
    );
    const ihcItemAfterAccession = itemDetailAfterAccession.body.workflowPlan.itemPlans.find(
      (item: { testTypeId: string }) => item.testTypeId === "test-im-t-01",
    );
    assert.ok(ihcItemAfterAccession.dependencies.some((dependency: { code: string; status: string }) =>
      dependency.code === "histology_block_available" && dependency.status === "pending",
    ));

    const grossing = await request
      .post(`/api/accessions/${accessionId}/grossing`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        grossDescription: "Shared biopsy specimen for H&E and IHC",
        numberOfBlocks: 1,
        scannedCode: accessionLookup.body.accessionId,
      });
    assert.equal(grossing.status, 200);
    const blockId = grossing.body.blocks[0].blockId as string;

    const processing = await request
      .post(`/api/accessions/${accessionId}/processing`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ processingNotes: "Routine processing", scannedCode: accessionLookup.body.accessionId });
    assert.equal(processing.status, 200);

    const embedding = await request
      .post(`/api/accessions/${accessionId}/embedding`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ blockId, scannedCode: blockId });
    assert.equal(embedding.status, 200);

    const sectioning = await request
      .post(`/api/accessions/${accessionId}/sectioning`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ blockId, slideCount: 1, scannedCode: blockId });
    assert.equal(sectioning.status, 200);
    const slideId = sectioning.body.blocks[0].slides[0].slideId as string;

    const staining = await request
      .post(`/api/accessions/${accessionId}/staining`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ slideId, stainType: "H&E", scannedCode: slideId });
    assert.equal(staining.status, 200);

    const prematureReview = await request
      .post(`/api/orders/${orderCreate.body._id}/ready-for-review`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ pathologistId: pathologist._id, scannedCode: accessionLookup.body.accessionId });
    assert.equal(prematureReview.status, 400);
    assert.match(prematureReview.body.message, /IHC/i);

    const afterHistology = await request
      .get(`/api/orders/${orderCreate.body._id}`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(afterHistology.status, 200);
    const ihcItemReady = afterHistology.body.workflowPlan.itemPlans.find(
      (item: { testTypeId: string }) => item.testTypeId === "test-im-t-01",
    );
    assert.equal(ihcItemReady.nextStageId, "ihc");
    assert.ok(ihcItemReady.dependencies.some((dependency: { code: string; status: string }) =>
      dependency.code === "histology_block_available" && dependency.status === "satisfied",
    ));
    const biopsyItemReady = afterHistology.body.workflowPlan.itemPlans.find(
      (item: { testTypeId: string }) => item.testTypeId === "test-hi-t-001",
    );
    assert.equal(biopsyItemReady.nextStageId, "pathologist_review");

    const ihc = await request
      .post(`/api/slides/${slideId}/ihc`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        antibody: "Ki-67",
        clone: "MIB-1",
        antigenRetrieval: "HIER",
        detection: "DAB",
        counterstain: "Hematoxylin",
        lotNumber: "LOT-KI67-001",
        controlSlideStatus: "pass",
        quantity: 1,
        qcNotes: "Control acceptable",
        scannedCode: slideId,
      });
    assert.equal(ihc.status, 200);

    const readyForReview = await request
      .post(`/api/orders/${orderCreate.body._id}/ready-for-review`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ pathologistId: pathologist._id, scannedCode: accessionLookup.body.accessionId });
    assert.equal(readyForReview.status, 200);

    const reportSave = await request
      .post(`/api/reports/${orderCreate.body._id}/save`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        diagnosis: "Benign tissue with proliferative index recorded",
        microscopicDescription: "H&E and Ki-67 reviewed.",
        grossDescription: "One tissue block.",
        comment: "Multi-test order completed.",
      });
    assert.equal(reportSave.status, 200);

    const reportLock = await request
      .post(`/api/reports/${orderCreate.body._id}/lock`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    assert.equal(reportLock.status, 200);

    const reportRelease = await request
      .post(`/api/reports/${orderCreate.body._id}/email`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    assert.equal(reportRelease.status, 200);

    const finalDetail = await request
      .get(`/api/orders/${orderCreate.body._id}`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(finalDetail.status, 200);
    assert.equal(finalDetail.body.status, "released");
    assert.equal(finalDetail.body.workflowPlan.itemSummary.released, 2);

    const dashboard = await request
      .get("/api/dashboard/summary")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(dashboard.status, 200);
    assert.ok(Number(dashboard.body.workflowItems.released) >= 2);
    assert.equal(typeof dashboard.body.workflowItems.pending, "number");
    assert.equal(typeof dashboard.body.workflowItems.blocked, "number");
    assert.equal(typeof dashboard.body.workflowItems.completed, "number");
  });

  test("external clinician portal creates authorized patients, referral orders, OCR orders, invoices, and only released reports", async () => {
    const doctorToken = await loginUser("doctor@xpath.lims");

    const profile = await request
      .get("/api/doctors/me/profile")
      .set("Authorization", `Bearer ${doctorToken}`);
    assert.equal(profile.status, 200);
    assert.ok(profile.body._id);

    const patientCreate = await request
      .post("/api/doctors/me/patients")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        firstName: "Clinician",
        lastName: `Referral${Date.now()}`,
        dateOfBirth: "1978-02-03",
        gender: "female",
        phone: "+237699001122",
        email: `clinician.patient.${Date.now()}@xpath.test`,
        address: "Yaounde",
        externalPatientId: "EXT-CLINICIAN-1",
      });
    assert.equal(patientCreate.status, 201);
    assert.ok(patientCreate.body.authorizedDoctorIds.includes(profile.body._id));

    const patientList = await request
      .get("/api/doctors/me/patients")
      .set("Authorization", `Bearer ${doctorToken}`);
    assert.equal(patientList.status, 200);
    assert.ok(patientList.body.data.some((entry: { _id: string }) => entry._id === patientCreate.body._id));

    const referralOrder = await request
      .post("/api/doctors/me/orders")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        patientId: patientCreate.body._id,
        testTypeIds: ["test-hi-t-001"],
        priority: "urgent",
        clinicalHistory: "Clinician portal end-to-end referral",
        payerType: "clinician",
        billingAccountName: "Referral Clinic",
        billingInstructions: "Bill referring clinician after invoice approval.",
      });
    assert.equal(referralOrder.status, 201);
    assert.equal(referralOrder.body.orderSource, "referral");
    assert.equal(referralOrder.body.referringDoctorId._id, profile.body._id);
    assert.equal(referralOrder.body.workflowPlan.itemPlans.length, 1);
    assert.equal(referralOrder.body.payerType, "clinician");
    assert.equal(referralOrder.body.financialClearance, "pending");
    const referralOrderId = referralOrder.body._id as string;

    const doctorOrderDetailBeforeRelease = await request
      .get(`/api/orders/${referralOrderId}`)
      .set("Authorization", `Bearer ${doctorToken}`);
    assert.equal(doctorOrderDetailBeforeRelease.status, 200);
    assert.equal(doctorOrderDetailBeforeRelease.body.report, null);

    const ocrReferral = await request
      .post("/api/doctors/me/orders/ocr")
      .set("Authorization", `Bearer ${doctorToken}`)
      .field(
        "text",
        "Patient name: OCR Referral\nDOB: 1984-04-05\nPhone: +237699004455\nEmail: ocr.referral@xpath.test\nAddress: Douala\nClinical history: Clinician OCR requisition\nRequested tests: HE, IHC",
      )
      .field(
        "corrections",
        JSON.stringify({
          source: "clinician_portal",
          testCodes: ["HE", "IHC"],
          payerType: "insurance",
          billingAccountName: "Clinician Insurance Desk",
        }),
      );
    assert.equal(ocrReferral.status, 201);
    assert.equal(ocrReferral.body.order.orderSource, "referral");
    assert.equal(ocrReferral.body.order.intakeSource, "ocr_nlp");
    assert.ok(ocrReferral.body.order.workflowPlan.itemPlans.length >= 2);

    const clinicianOrdersBeforeRelease = await request
      .get("/api/doctors/me/orders")
      .set("Authorization", `Bearer ${doctorToken}`);
    assert.equal(clinicianOrdersBeforeRelease.status, 200);
    const listedReferral = clinicianOrdersBeforeRelease.body.data.find(
      (entry: { _id: string }) => entry._id === referralOrderId,
    );
    assert.ok(listedReferral);
    assert.ok(listedReferral.invoice);
    assert.equal(listedReferral.report, null);
    assert.equal(listedReferral.reportReleased, false);

    const payment = await request
      .post(`/api/orders/${referralOrderId}/payment`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        amount: 1000000,
        method: "cash",
        status: "completed",
      });
    assert.equal(payment.status, 201);

    const receptionIntake = await request
      .post(`/api/orders/${referralOrderId}/reception-intake`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        paymentCollectionStatus: "reconciled",
        paymentCollectionMethod: "cash",
        paymentCollectionAmount: 1000000,
        paymentCollectionReference: "TEST-CLINICIAN-E2E",
        transportTemperature: "ambient",
        transportCondition: "stable",
        sampleCondition: "Referral sample received intact",
        scannedCode: referralOrder.body.orderNumber,
      });
    assert.equal(receptionIntake.status, 200);

    const users = await request
      .get("/api/users")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(users.status, 200);
    const technician = users.body.find((entry: { role: string }) => entry.role === "technician");
    const pathologist = users.body.find((entry: { role: string }) => entry.role === "pathologist");
    assert.ok(technician);
    assert.ok(pathologist);

    const releaseToLab = await request
      .post(`/api/orders/${referralOrderId}/release-to-lab`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ technicianId: technician._id, scannedCode: referralOrder.body.orderNumber });
    assert.equal(releaseToLab.status, 200);

    const startProcessing = await request
      .post(`/api/orders/${referralOrderId}/start-processing`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ scannedCode: referralOrder.body.orderNumber });
    assert.equal(startProcessing.status, 200);

    const accessionLookup = await request
      .get(`/api/accessions/by-order/${referralOrderId}`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(accessionLookup.status, 200);
    const accessionId = accessionLookup.body._id as string;

    const grossing = await request
      .post(`/api/accessions/${accessionId}/grossing`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        grossDescription: "Referral biopsy specimen",
        numberOfBlocks: 1,
        scannedCode: accessionLookup.body.accessionId,
      });
    assert.equal(grossing.status, 200);
    const blockId = grossing.body.blocks[0].blockId as string;

    const processing = await request
      .post(`/api/accessions/${accessionId}/processing`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ processingNotes: "Referral processing", scannedCode: accessionLookup.body.accessionId });
    assert.equal(processing.status, 200);

    const embedding = await request
      .post(`/api/accessions/${accessionId}/embedding`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ blockId, scannedCode: blockId });
    assert.equal(embedding.status, 200);

    const sectioning = await request
      .post(`/api/accessions/${accessionId}/sectioning`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ blockId, slideCount: 1, scannedCode: blockId });
    assert.equal(sectioning.status, 200);
    const slideId = sectioning.body.blocks[0].slides[0].slideId as string;

    const staining = await request
      .post(`/api/accessions/${accessionId}/staining`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ slideId, stainType: "H&E", scannedCode: slideId });
    assert.equal(staining.status, 200);

    const readyForReview = await request
      .post(`/api/orders/${referralOrderId}/ready-for-review`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ pathologistId: pathologist._id, scannedCode: accessionLookup.body.accessionId });
    assert.equal(readyForReview.status, 200);

    const reportSave = await request
      .post(`/api/reports/${referralOrderId}/save`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        diagnosis: "Referral biopsy released diagnosis",
        microscopicDescription: "Reviewed referral sections.",
        grossDescription: "One referral biopsy block.",
        comment: "External clinician portal E2E release.",
      });
    assert.equal(reportSave.status, 200);

    const reportLock = await request
      .post(`/api/reports/${referralOrderId}/lock`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    assert.equal(reportLock.status, 200);

    const reportRelease = await request
      .post(`/api/reports/${referralOrderId}/email`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    assert.equal(reportRelease.status, 200);

    const clinicianOrdersAfterRelease = await request
      .get("/api/doctors/me/orders")
      .set("Authorization", `Bearer ${doctorToken}`);
    assert.equal(clinicianOrdersAfterRelease.status, 200);
    const releasedReferral = clinicianOrdersAfterRelease.body.data.find(
      (entry: { _id: string }) => entry._id === referralOrderId,
    );
    assert.ok(releasedReferral);
    assert.equal(releasedReferral.status, "released");
    assert.equal(releasedReferral.reportReleased, true);
    assert.match(releasedReferral.report.diagnosis, /Referral biopsy released diagnosis/);

    const doctorOrderDetailAfterRelease = await request
      .get(`/api/orders/${referralOrderId}`)
      .set("Authorization", `Bearer ${doctorToken}`);
    assert.equal(doctorOrderDetailAfterRelease.status, 200);
    assert.equal(doctorOrderDetailAfterRelease.body.reportReleased, true);
    assert.match(doctorOrderDetailAfterRelease.body.report.diagnosis, /Referral biopsy released diagnosis/);

    const orderAudit = await request
      .get(`/api/orders/${referralOrderId}/audit`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(orderAudit.status, 200);
    assert.ok(orderAudit.body.some((entry: { action: string }) => entry.action === "create_clinician_referral"));
  });

  test("connector and payment readiness endpoints return production configuration details", async () => {
    const mavianceConfig = await request
      .get("/api/payments/maviance/config")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(mavianceConfig.status, 200);
    assert.ok(Array.isArray(mavianceConfig.body.channels));
    assert.equal(typeof mavianceConfig.body.credentialsConfigured, "boolean");

    const connectorList = await request
      .get("/api/vendor-connectors")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(connectorList.status, 200);
    assert.ok(Array.isArray(connectorList.body));
    const simulatedConnector = connectorList.body.find(
      (entry: { liveMode?: boolean }) => entry.liveMode === false,
    );
    assert.ok(simulatedConnector);

    const connectorTest = await request
      .post(`/api/vendor-connectors/${simulatedConnector._id}/test`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(connectorTest.status, 200);
    assert.equal(connectorTest.body.simulated, true);

    const readiness = await request
      .get("/api/integration-readiness")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(readiness.status, 200);
    assert.ok(Array.isArray(readiness.body.vendorConnectors));
    assert.equal(typeof readiness.body.maviance.credentialsConfigured, "boolean");
  });

  test("production controls expose ledger, validation, chat, offline, and MFA readiness", async () => {
    const readiness = await request
      .get("/api/production-readiness")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(readiness.status, 200);
    assert.equal(typeof readiness.body.audit.valid, "boolean");

    const monthlyFinance = await request
      .get("/api/finance/monthly-dashboard")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(monthlyFinance.status, 200);
    assert.ok(Array.isArray(monthlyFinance.body.rows));

    const zohoConfig = await request
      .get("/api/accounting/zoho/config")
      .set("Authorization", `Bearer ${authToken}`)
    assert.equal(zohoConfig.status, 200);
    assert.equal(typeof zohoConfig.body.clientConfigured, "boolean");

    const zohoLogs = await request
      .get("/api/accounting/zoho/sync-logs")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(zohoLogs.status, 200);
    assert.ok(Array.isArray(zohoLogs.body));

    const validation = await request
      .post(`/api/orders/${createdOrderId}/validation/evaluate`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    assert.equal(validation.status, 200);
    assert.equal(typeof validation.body.valid, "boolean");

    const barcodeScan = await request
      .post("/api/barcodes/scan")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        code: "NOT-A-REAL-BARCODE",
        workflowStep: "accessioning",
      });
    assert.equal(barcodeScan.status, 409);
    assert.equal(barcodeScan.body.outcome, "rejected");

    const chatThread = await request
      .post("/api/communications/threads")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "Test production chat",
        department: "histology",
        participantUserIds: [],
      });
    assert.equal(chatThread.status, 201);

    const chatMessage = await request
      .post(`/api/communications/threads/${chatThread.body._id}/messages`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ body: "Test message from production controls" });
    assert.equal(chatMessage.status, 201);
    assert.equal(chatMessage.body.threadId, chatThread.body._id);

    const offlineSnapshot = await request
      .get("/api/offline/snapshot")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(offlineSnapshot.status, 200);
    assert.ok(Array.isArray(offlineSnapshot.body.orders));

    const mfaSetup = await request
      .post("/api/security/mfa/setup")
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    assert.equal(mfaSetup.status, 200);
    assert.match(mfaSetup.body.otpauthUrl, /^otpauth:\/\/totp\//);

    const specialistAssist = await request
      .post("/api/ai/specialist-assist")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        context: "order_intake",
        targetField: "order_notes",
        orderId: createdOrderId,
        text: "Patient reports breast lump and requests histology.",
      });
    assert.equal(specialistAssist.status, 200);
    assert.equal(specialistAssist.body.provider, "local-template");
    assert.match(specialistAssist.body.safety, /Drafting aid only/);

    const doctorToken = await loginUser("doctor@xpath.lims");
    const forbiddenReportAssist = await request
      .post("/api/ai/specialist-assist")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        context: "pathology_report",
        targetField: "diagnosis",
        text: "Draft diagnosis",
      });
    assert.equal(forbiddenReportAssist.status, 403);

    const disabledWhisper = await request
      .post("/api/ai/transcribe")
      .set("Authorization", `Bearer ${authToken}`)
      .field("context", "order_intake")
      .attach("audio", Buffer.from("not-real-audio", "utf8"), {
        filename: "dictation.webm",
        contentType: "audio/webm",
      });
    assert.equal(disabledWhisper.status, 503);
  });

  test("department communications support linked regulated threads, broadcasts, exceptions, read receipts, and attachments", async () => {
    const pathologistToken = await loginUser("pathologist@xpath.lims");
    const technicianToken = await loginUser("technician@xpath.lims");

    const orderDetail = await request
      .get(`/api/orders/${createdOrderId}`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(orderDetail.status, 200);
    const orderItemId = orderDetail.body.workflowPlan.itemPlans[0]?.orderItemId as string | undefined;
    assert.ok(orderItemId);
    const specimenId = (orderDetail.body.sample?._id ?? createdAccessionId) as string;
    assert.ok(specimenId);

    const invoices = await request
      .get("/api/invoices")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(invoices.status, 200);
    const invoice = invoices.body.find((entry: { orderId: string }) => entry.orderId === createdOrderId);

    const directRejected = await request
      .post("/api/communications/threads")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "Invalid direct communication",
        threadType: "direct",
        departments: ["histology"],
        participantUserIds: [],
      });
    assert.equal(directRejected.status, 400);

    const linkedThread = await request
      .post("/api/communications/threads")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "Specimen handoff escalation",
        threadType: "department",
        departments: ["receptionist", "histology"],
        participantUserIds: [],
        linkedOrderId: createdOrderId,
        linkedSpecimenId: specimenId,
        linkedOrderItemId: orderItemId,
        linkedInvoiceId: invoice?._id,
        priority: "urgent",
        regulated: true,
      });
    assert.equal(linkedThread.status, 201);
    assert.equal(linkedThread.body.threadType, "department");
    assert.equal(linkedThread.body.linkedOrderId, createdOrderId);
    assert.equal(linkedThread.body.linkedOrderItemId, orderItemId);
    assert.equal(linkedThread.body.regulated, true);

    const regulatedMessage = await request
      .post(`/api/communications/threads/${linkedThread.body._id}/messages`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        body: "Histology needs accession context before continuing.",
        mandatoryRead: true,
      });
    assert.equal(regulatedMessage.status, 201);
    assert.equal(regulatedMessage.body.mandatoryRead, true);
    assert.equal(regulatedMessage.body.regulated, true);

    const pathologistRead = await request
      .post(`/api/communications/threads/${linkedThread.body._id}/read`)
      .set("Authorization", `Bearer ${pathologistToken}`)
      .send({});
    assert.equal(pathologistRead.status, 200);
    const readMessage = pathologistRead.body.find(
      (entry: { _id: string }) => entry._id === regulatedMessage.body._id,
    );
    assert.ok(readMessage);
    assert.ok(readMessage.readBy.length >= 2);

    const attachment = await request
      .post(`/api/communications/threads/${linkedThread.body._id}/attachments`)
      .set("Authorization", `Bearer ${authToken}`)
      .field("messageId", regulatedMessage.body._id)
      .attach("file", Buffer.from("handoff attachment body", "utf8"), {
        filename: "handoff.txt",
        contentType: "text/plain",
      });
    assert.equal(attachment.status, 201);
    assert.equal(attachment.body.attachment.filename, "handoff.txt");
    assert.equal(typeof attachment.body.attachment.checksumSha256, "string");
    assert.ok(attachment.body.attachment.retentionUntil);
    assert.equal(attachment.body.message.attachments.length, 1);

    const download = await request
      .get(
        `/api/communications/threads/${linkedThread.body._id}/attachments/${attachment.body.attachment._id}/file`,
      )
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(download.status, 200);
    assert.match(download.text, /handoff attachment body/);

    const rejectedBroadcast = await request
      .post("/api/communications/broadcasts")
      .set("Authorization", `Bearer ${technicianToken}`)
      .send({
        title: "Unauthorized broadcast",
        body: "This should not be accepted.",
        audienceRoles: ["admin"],
      });
    assert.equal(rejectedBroadcast.status, 403);

    const broadcast = await request
      .post("/api/communications/broadcasts")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "Quality broadcast",
        body: "Quality notice for regulated handoff.",
        departments: ["quality"],
        audienceRoles: ["admin", "technician", "pathologist"],
        linkedOrderId: createdOrderId,
        priority: "critical",
        regulated: true,
        mandatoryRead: true,
      });
    assert.equal(broadcast.status, 201);
    assert.equal(broadcast.body.thread.threadType, "broadcast");
    assert.equal(broadcast.body.thread.broadcast, true);
    assert.equal(broadcast.body.message.messageType, "broadcast");
    assert.equal(broadcast.body.message.mandatoryRead, true);
    assert.ok(broadcast.body.notification._id);

    const exception = await request
      .post("/api/communications/exceptions")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        exceptionType: "missing_payment",
        title: "Missing payment alert",
        body: "Finance must resolve payment before release.",
        linkedOrderId: createdOrderId,
        linkedInvoiceId: invoice?._id,
        priority: "critical",
      });
    assert.equal(exception.status, 201);
    assert.equal(exception.body.thread.threadType, "exception");
    assert.equal(exception.body.thread.exceptionType, "missing_payment");
    assert.equal(exception.body.thread.regulated, true);
    assert.equal(exception.body.message.messageType, "exception");
    assert.equal(exception.body.message.mandatoryRead, true);

    const qcEvent = await request
      .post("/api/quality-events")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        module: "Histology",
        eventType: "qc",
        status: "open",
        summary: "Automated QC failure should create an exception alert.",
        owner: "Quality",
      });
    assert.equal(qcEvent.status, 201);

    const syncedExceptions = await request
      .post("/api/communications/exceptions/sync")
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    assert.equal(syncedExceptions.status, 200);
    assert.equal(typeof syncedExceptions.body.createdCount, "number");
    assert.ok(
      syncedExceptions.body.created.some(
        (entry: { thread: { exceptionType: string; sourceReferenceId?: string | null } }) =>
          entry.thread.exceptionType === "failed_qc" && entry.thread.sourceReferenceId,
      ),
    );

    const orderAudit = await request
      .get(`/api/orders/${createdOrderId}/audit`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(orderAudit.status, 200);
    assert.ok(
      orderAudit.body.some((entry: { action: string }) =>
        [
          "create_department_thread",
          "acknowledge_regulated_messages",
          "upload_attachment",
          "create_broadcast_notice",
          "create_exception_alert",
        ].includes(entry.action),
      ),
    );

    const auditVerify = await request
      .get("/api/audit/verify")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(auditVerify.status, 200);
    assert.equal(auditVerify.body.valid, true);
  });

  test("module one and two governance flows enforce verification, approvals, and reversals", async () => {
    const pathologistToken = await loginUser("pathologist@xpath.lims");
    const financeToken = await loginUser("finance@xpath.lims");
    const superAdminToken = await loginUser("superadmin@xpath.lims");

    const ocrJob = await request
      .post("/api/intake/ocr/jobs")
      .set("Authorization", `Bearer ${authToken}`)
      .field(
        "text",
        "Patient name: Alpha Verify\nDOB: 1985-03-04\nPhone: +237690000001\nEmail: alpha.verify@xpath.test\nAddress: Yaounde\nClinical history: OCR verified bleeding history\nRequested tests: HE",
      );
    assert.equal(ocrJob.status, 201);
    assert.equal(ocrJob.body.status, "needs_verification");
    assert.equal(typeof ocrJob.body.confidence, "number");

    const verifiedPayload = {
      ...ocrJob.body.parsedPayload,
      testTypeIds: ["test-hi-t-001"],
      matchedTestCodes: ["HE"],
    };
    const verifyOcr = await request
      .post(`/api/intake/ocr/jobs/${ocrJob.body._id}/verify`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ parsedPayload: verifiedPayload, verificationNotes: "Verified in automated test" });
    assert.equal(verifyOcr.status, 200);
    assert.equal(verifyOcr.body.status, "verified");

    const convertedOrder = await request
      .post(`/api/intake/ocr/jobs/${ocrJob.body._id}/convert-order`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    assert.equal(convertedOrder.status, 201);
    assert.equal(convertedOrder.body.intakeSource, "ocr_nlp");

    const ruleCreate = await request
      .post("/api/validation-rules")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "Automated test rule",
        scope: "order",
        severity: "warning",
        active: true,
        requiredFields: ["patient.dateOfBirth"],
        message: "Patient DOB is required",
      });
    assert.equal(ruleCreate.status, 201);

    const ruleUpdate = await request
      .put(`/api/validation-rules/${ruleCreate.body._id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "Automated test rule updated",
        scope: "order",
        severity: "blocking",
        active: true,
        requiredFields: ["patient.dateOfBirth"],
        message: "Patient DOB is required for processing",
      });
    assert.equal(ruleUpdate.status, 200);
    assert.equal(ruleUpdate.body.severity, "blocking");

    const lock = await request
      .post(`/api/orders/${createdOrderId}/lock`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ reason: "Controlled amendment test lock" });
    assert.equal(lock.status, 200);
    assert.equal(lock.body.lockStatus, "locked");

    const blockedDirectEdit = await request
      .put(`/api/orders/${createdOrderId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ notes: "This direct edit must be blocked" });
    assert.equal(blockedDirectEdit.status, 400);
    assert.match(blockedDirectEdit.body.message, /controlled correction/i);

    const correction = await request
      .post(`/api/orders/${createdOrderId}/corrections`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        reason: "Correct locked order note",
        changes: { notes: "Controlled correction applied" },
      });
    assert.equal(correction.status, 201);

    const correctionApproval = await request
      .post(`/api/orders/${createdOrderId}/corrections/${correction.body._id}/approve`)
      .set("Authorization", `Bearer ${pathologistToken}`)
      .send({});
    assert.equal(correctionApproval.status, 200);
    assert.equal(correctionApproval.body.status, "applied");

    const refund = await request
      .post("/api/refunds")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        orderId: createdOrderId,
        invoiceId: null,
        type: "adjustment",
        amount: 10,
        reason: "Automated adjustment approval",
        status: "completed",
      });
    assert.equal(refund.status, 201);
    assert.equal(refund.body.status, "pending");

    const firstApproval = await request
      .post(`/api/refunds/${refund.body._id}/approve`)
      .set("Authorization", `Bearer ${financeToken}`)
      .send({});
    assert.equal(firstApproval.status, 200);
    assert.equal(firstApproval.body.status, "pending");
    assert.equal(firstApproval.body.approvals.length, 1);

    const secondApproval = await request
      .post(`/api/refunds/${refund.body._id}/approve`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({});
    assert.equal(secondApproval.status, 200);
    assert.equal(secondApproval.body.status, "approved");
    assert.equal(secondApproval.body.reversalJournalEntryId ?? null, null);

    const completed = await request
      .post(`/api/refunds/${refund.body._id}/complete`)
      .set("Authorization", `Bearer ${financeToken}`)
      .send({});
    assert.equal(completed.status, 200);
    assert.equal(completed.body.status, "completed");

    const zohoConfig = await request
      .get("/api/accounting/zoho/config")
      .set("Authorization", `Bearer ${financeToken}`);
    assert.equal(zohoConfig.status, 200);
    assert.equal(typeof zohoConfig.body.organizationConfigured, "boolean");

    const ruleDelete = await request
      .delete(`/api/validation-rules/${ruleCreate.body._id}`)
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(ruleDelete.status, 200);
  });

  test("logout revokes the active session immediately", async () => {
    const token = await loginAdmin();

    const meBefore = await request
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(meBefore.status, 200);

    const logout = await request
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(logout.status, 204);

    const meAfter = await request
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(meAfter.status, 401);
  });
});
