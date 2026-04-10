import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoClient } from "mongodb";
import supertest from "supertest";

const testCollection = `app_state_test_${Date.now()}`;
process.env.MONGODB_COLLECTION = testCollection;
process.env.HL7_MLLP_ENABLED = "false";

let request: ReturnType<typeof supertest>;
let mongoClient: MongoClient | null = null;
let mongoDbName = "";
let authToken = "";
let createdOrderId = "";
let createdAccessionId = "";

async function loginAdmin() {
  const login = await request.post("/api/auth/login").send({
    email: "admin@xpath.lims",
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
  mongoDbName = configModule.MONGODB_DB_NAME;
  mongoClient = new MongoClient(configModule.MONGODB_URI);
  await mongoClient.connect();
});

after(async () => {
  const storeModule = await import("../src/store.js");
  await storeModule.closeStoreConnections();
  if (mongoClient) {
    await mongoClient.db(mongoDbName).collection(testCollection).drop().catch(() => undefined);
    await mongoClient.close();
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

    const markReceived = await request
      .post(`/api/orders/${createdOrderId}/mark-received`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    assert.equal(markReceived.status, 200);

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
