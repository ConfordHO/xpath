import json
import os
import tempfile
import unittest
from django.core.files.uploadedfile import SimpleUploadedFile

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "xpath_lims.settings")
os.environ.setdefault("XPATH_ON_PREM_STATE_FILE", os.path.join(tempfile.gettempdir(), "xpath-lims-test-state.json"))
os.environ.setdefault("XPATH_STATE_BACKEND", "file")

import django
from django.test import Client


django.setup()


class DjangoCompatibilityApiTests(unittest.TestCase):
    def setUp(self) -> None:
        from apps.core import views
        from apps.core.domain import LimsRepository

        state_file = os.environ["XPATH_ON_PREM_STATE_FILE"]
        if os.path.exists(state_file):
            os.unlink(state_file)
        views.repo = LimsRepository(state_file)
        self.client = Client()

    def post_json(self, path: str, payload: dict):
        return self.client.post(
            path,
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_login_me_and_seed_catalog(self):
        login = self.post_json(
            "/api/auth/login",
            {"email": "kiy@xpath-labs.com", "password": "password"},
        )
        self.assertEqual(login.status_code, 200)
        token = login.json()["token"]

        me = self.client.get("/api/users/me", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["role"], "super_admin")

        services = self.client.get("/api/public/services")
        self.assertEqual(services.status_code, 200)
        self.assertTrue(any(item["code"] == "HISTO-BX" for item in services.json()))

    def test_master_data_doctor_credentials_and_doctor_portal_order(self):
        created_test = self.post_json(
            "/api/test-types",
            {
                "code": "GLU",
                "name": "Glucose",
                "category": "analyzer",
                "price": 3500,
                "workflow": ["accessioning", "analyzer_run", "pathologist_review", "result_release"],
            },
        )
        self.assertEqual(created_test.status_code, 201)
        self.assertEqual(created_test.json()["code"], "GLU")

        doctor = self.post_json(
            "/api/doctors",
            {
                "name": "Dr Jeanne Referrer",
                "code": "DR-JR",
                "type": "doctor",
                "email": "jeanne.referrer@example.cm",
                "phone": "+237600000009",
            },
        )
        self.assertEqual(doctor.status_code, 201)
        generated_password = doctor.json()["generatedPassword"]
        self.assertTrue(generated_password)

        login = self.post_json(
            "/api/auth/login",
            {"email": "jeanne.referrer@example.cm", "password": generated_password},
        )
        self.assertEqual(login.status_code, 200)
        token = login.json()["token"]

        portal_order = self.client.post(
            "/api/doctors/me/orders",
            data=json.dumps(
                {
                    "patient": {"firstName": "Referral", "lastName": "Patient", "dateOfBirth": "1992-01-01"},
                    "testCodes": ["GLU"],
                    "clinicalHistory": "Clinician portal order",
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(portal_order.status_code, 201)
        self.assertEqual(portal_order.json()["orderSource"], "clinician_portal")
        self.assertEqual(portal_order.json()["clinicalHistory"], "Clinician portal order")

    def test_legacy_order_payment_and_audit_routes(self):
        patient = self.post_json(
            "/api/patients",
            {
                "firstName": "Grace",
                "lastName": "Ewondo",
                "dateOfBirth": "1982-03-04",
                "phone": "+237600000002",
            },
        )
        self.assertEqual(patient.status_code, 201)

        order = self.post_json(
            "/api/orders",
            {
                "patientId": patient.json()["_id"],
                "testTypeIds": ["CBC", "HISTO-BX"],
                "orderSource": "walk_in",
                "priority": "normal",
            },
        )
        self.assertEqual(order.status_code, 201)
        order_number = order.json()["orderNumber"]
        self.assertEqual(len(order.json()["items"]), 2)

        payment = self.post_json(
            f"/api/orders/{order_number}/payment",
            {
                "amount": 31000,
                "method": "mtn_mobile_money",
                "status": "completed",
                "gatewayReference": "MAV-API-1",
            },
        )
        self.assertEqual(payment.status_code, 201)
        self.assertEqual(payment.json()["receipt"]["provider"], "maviance")
        self.assertEqual(payment.json()["order"]["financialClearance"], "cleared")

        audit = self.client.get("/api/audit/verify")
        self.assertEqual(audit.status_code, 200)
        self.assertTrue(audit.json()["hashChainValid"])

    def test_public_order_request_and_ocr_job_alias(self):
        public_order = self.post_json(
            "/api/public/order-request",
            {
                "firstName": "Claire",
                "lastName": "Meka",
                "dateOfBirth": "1991-06-07",
                "testCodes": ["CYTO"],
                "requisition": {
                    "referringPhysicianName": "Dr Online Referrer",
                    "clinicalHistory": "Nested online form history",
                },
            },
        )
        self.assertEqual(public_order.status_code, 201)
        self.assertIn("orderNumber", public_order.json())

        ocr = self.post_json(
            "/api/intake/ocr/jobs",
            {
                "extractedText": "First Name: Alain\nLast Name: Biloa\nDOB: 1975-01-02\nCBC and biopsy",
                "fileText": "same typed note",
                "verify": True,
            },
        )
        self.assertEqual(ocr.status_code, 201)
        self.assertEqual(ocr.json()["job"]["status"], "converted_to_order")
        self.assertEqual(len(ocr.json()["order"]["items"]), 2)

    def test_ocr_accepts_multiple_files_and_cors_preflight(self):
        preflight = self.client.options(
            "/api/auth/login",
            HTTP_ORIGIN="http://127.0.0.1:3000",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        )
        self.assertEqual(preflight.status_code, 204)
        self.assertEqual(preflight["Access-Control-Allow-Origin"], "http://127.0.0.1:3000")

        upload = self.client.post(
            "/api/intake/ocr/jobs",
            data={
                "verify": "true",
                "corrections": json.dumps(
                    {
                        "source": "patient_portal",
                        "patient": {
                            "firstName": "Multi",
                            "lastName": "Upload",
                            "dateOfBirth": "1995-01-01",
                        },
                        "testCodes": ["CBC", "CYTO"],
                        "clinicalNotes": "Multiple uploaded requisition files",
                    }
                ),
                "files": [
                    SimpleUploadedFile("note-1.txt", b"First Name: Multi\nCBC"),
                    SimpleUploadedFile("note-2.txt", b"cytology requested"),
                ],
            },
        )
        self.assertEqual(upload.status_code, 201)
        self.assertEqual(upload.json()["order"]["orderSource"], "patient_portal")
        self.assertEqual(len(upload.json()["order"]["items"]), 2)

    def test_workflow_and_report_legacy_routes(self):
        patient = self.post_json(
            "/api/patients",
            {"firstName": "Nora", "lastName": "Talla", "dateOfBirth": "1985-05-06"},
        ).json()
        order_response = self.post_json(
            "/api/orders",
            {
                "patientId": patient["_id"],
                "testTypeIds": ["CBC"],
                "orderSource": "walk_in",
            },
        )
        order = order_response.json()
        order_number = order["orderNumber"]
        self.post_json(
            f"/api/orders/{order_number}/payment",
            {"amount": 6000, "method": "cash", "status": "completed", "gatewayReference": "CASH-1"},
        )

        release = self.post_json(f"/api/orders/{order_number}/release-to-lab", {})
        self.assertEqual(release.status_code, 200)
        start = self.post_json(f"/api/orders/{order_number}/start-processing", {})
        self.assertEqual(start.status_code, 200)

        refreshed = self.client.get(f"/api/orders/{order_number}").json()
        item_id = refreshed["items"][0]["_id"]
        for step in ["analyzer_run", "pathologist_review", "result_release"]:
            step_response = self.post_json(
                f"/api/orders/{order_number}/complete-technical-step",
                {"itemId": item_id, "step": step},
            )
            self.assertEqual(step_response.status_code, 200)

        save = self.post_json(
            f"/api/reports/{order_number}/save",
            {"diagnosis": "No malignant cells identified", "conclusion": "Released"},
        )
        self.assertEqual(save.status_code, 200)
        self.post_json(f"/api/reports/{order_number}/lock", {})
        signed = self.post_json(f"/api/reports/{order_number}/sign", {})
        self.assertEqual(signed.status_code, 200)
        released = self.post_json(f"/api/reports/{order_number}/email", {})
        self.assertEqual(released.json()["status"], "released")

    def test_gateway_communications_archive_and_sync_routes(self):
        patient = self.post_json(
            "/api/patients",
            {"firstName": "Eric", "lastName": "Owona", "dateOfBirth": "1970-04-03"},
        ).json()
        order = self.post_json(
            "/api/orders",
            {"patientId": patient["_id"], "testTypeIds": ["CBC"], "orderSource": "walk_in"},
        ).json()
        order_number = order["orderNumber"]

        gateway = self.post_json(
            "/api/payments/maviance/initiate",
            {"orderNumber": order_number, "amount": 6000, "channel": "mtn_cameroon", "customerPhone": "+237600000000"},
        )
        self.assertEqual(gateway.status_code, 201)
        transaction_id = gateway.json()["transaction"]["_id"]
        verified = self.post_json(f"/api/payments/maviance/transactions/{transaction_id}/verify", {})
        self.assertEqual(verified.status_code, 200)
        receipt_id = verified.json()["transaction"]["receiptNumber"]
        receipt_print = self.client.get(f"/api/receipts/{receipt_id}/print")
        self.assertEqual(receipt_print.status_code, 200)
        self.assertEqual(receipt_print.json()["printable"]["invoiceStatus"], "paid")

        thread = self.post_json(
            "/api/communications/threads",
            {"subject": "Department handoff", "department": "histology", "body": "Sample moved to histology"},
        )
        self.assertEqual(thread.status_code, 201)
        messages = self.client.get(f"/api/communications/threads/{thread.json()['_id']}/messages")
        self.assertEqual(messages.status_code, 200)
        self.assertEqual(len(messages.json()), 1)

        report = self.post_json(f"/api/reports/{order_number}/save", {"diagnosis": "Benign"})
        self.assertEqual(report.status_code, 200)
        self.post_json(f"/api/reports/{order_number}/sign", {})
        self.post_json(f"/api/reports/{order_number}/email", {})
        archive = self.post_json(f"/api/orders/{order_number}/archive", {})
        self.assertEqual(archive.status_code, 201)
        self.assertIn("retentionUntil", archive.json())

        sync = self.post_json("/api/sync/cloud/run", {})
        self.assertEqual(sync.status_code, 200)
        self.assertEqual(sync.json()["status"], "success")

    def test_module_audit_and_cameroon_compliance_routes(self):
        audit = self.client.get("/api/module-audit")
        self.assertEqual(audit.status_code, 200)
        self.assertEqual(audit.json()["moduleCount"], 25)
        self.assertEqual(audit.json()["backend"], "python-django")

        compliance = self.client.get("/api/compliance/cameroon")
        self.assertEqual(compliance.status_code, 200)
        self.assertEqual(compliance.json()["payments"]["providers"], ["maviance", "paystack"])


if __name__ == "__main__":
    unittest.main()
