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
        testTypeIds: ["test-biopsy"],
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
      .send({ technicianId: technician._id });
    assert.equal(releaseToLab.status, 200);

    const startProcessing = await request
      .post(`/api/orders/${createdOrderId}/start-processing`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
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
      testTypeIds: ["test-biopsy"],
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
